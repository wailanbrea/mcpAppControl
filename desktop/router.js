// Command Router — vive dentro del proceso principal de Electron.
// Reutiliza el protocolo del antiguo mcp-server/websocket-server.ts:
//  - Puente WebSocket con los agentes Android (register/heartbeat/command_result/...).
//  - POST /command/dispatch: el backend PHP manda aquí cada comando.
// Novedad (Fase 3): un transporte ADB inyectable para dispositivos por USB.

const http = require('http');
const { randomUUID } = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

let CONFIG = { wsPort: 6011, backendUrl: 'http://127.0.0.1:8733/api/v1', backendToken: '', wsAuthToken: '' };
const COMMAND_TIMEOUT_MS = parseInt(process.env.COMMAND_TIMEOUT_MS || '60000', 10);

// Estado en memoria
const devices = new Map();          // serial -> { serial_number, name, model, android_version, status, ws, last_seen }
const watchers = new Set();         // dashboards con {type:'watch'}
const pendingCommands = new Map();  // id -> { resolve, timer }

// Transporte ADB inyectable (Fase 3). Debe exponer:
//   has(serial) -> bool         ¿este serial es un dispositivo ADB?
//   execute(serial, command, params) -> Promise<{success,message,data}>
let adbTransport = null;
function setAdbTransport(t) { adbTransport = t; }

let httpServer = null;
let wss = null;

// ---------- Sincronización con el backend embebido ----------
function backendFetch(endpoint, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (CONFIG.backendToken) headers['Authorization'] = `Bearer ${CONFIG.backendToken}`;
  return fetch(CONFIG.backendUrl + endpoint, {
    method: 'POST', headers, body: JSON.stringify(data),
  }).catch(err => console.error(`[router] backend ${endpoint}:`, err.message));
}

function registerDeviceWithBackend(data) {
  return backendFetch('/devices', {
    serial_number: data.serial_number,
    name: data.name,
    model: data.model,
    android_version: data.android_version,
    status: 'online',
  });
}
function syncDeviceStatus(serial, status) {
  return backendFetch('/devices/heartbeat', { serial_number: serial, status });
}

function broadcast(event, data) {
  const message = JSON.stringify({ type: event, ...data, timestamp: new Date().toISOString() });
  for (const client of watchers) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

// ---------- Protocolo WebSocket (agentes) ----------
function handleConnection(ws) {
  let deviceSerial = null;
  let isWatcher = false;

  ws.on('message', (data) => {
    let message;
    try { message = JSON.parse(data.toString()); } catch { return; }

    switch (message.type) {
      case 'watch':
        isWatcher = true; watchers.add(ws);
        ws.send(JSON.stringify({ type: 'watching' }));
        break;

      case 'register': {
        if (CONFIG.wsAuthToken && message.token !== CONFIG.wsAuthToken) {
          ws.send(JSON.stringify({ type: 'error', message: 'Token inválido' })); ws.close(); return;
        }
        if (!message.serial_number) {
          ws.send(JSON.stringify({ type: 'error', message: 'serial_number requerido' })); return;
        }
        deviceSerial = message.serial_number;
        devices.set(deviceSerial, {
          serial_number: deviceSerial,
          name: message.name || `Dispositivo ${deviceSerial}`,
          model: message.model, android_version: message.android_version,
          status: 'online', ws, last_seen: Date.now(),
        });
        registerDeviceWithBackend(message);
        ws.send(JSON.stringify({ type: 'registered', serial_number: deviceSerial }));
        broadcast('device_connected', { serial_number: deviceSerial, name: message.name });
        break;
      }

      case 'heartbeat': {
        if (!deviceSerial) return;
        const device = devices.get(deviceSerial);
        if (device) { device.last_seen = Date.now(); device.status = message.status || 'online'; syncDeviceStatus(deviceSerial, device.status); }
        ws.send(JSON.stringify({ type: 'heartbeat_ack', timestamp: new Date().toISOString() }));
        break;
      }

      case 'command_result': {
        if (!deviceSerial) return;
        const pending = message.id ? pendingCommands.get(message.id) : undefined;
        if (pending) { clearTimeout(pending.timer); pendingCommands.delete(message.id); pending.resolve(message); }
        const device = devices.get(deviceSerial);
        if (device && device.status === 'busy') { device.status = 'online'; }
        backendFetch(`/devices/${deviceSerial}/command-result`, {
          command_type: message.command || 'UNKNOWN',
          success: !!message.success, message: message.message, result_data: message.data ?? {},
        });
        broadcast('command_result', { serial_number: deviceSerial, command: message.command, success: message.success });
        break;
      }

      case 'screenshot':
        if (!deviceSerial || !message.image) return;
        backendFetch(`/devices/${deviceSerial}/screenshot`, { image_data: message.image });
        broadcast('screenshot_received', { serial_number: deviceSerial });
        break;

      case 'log_entry':
        if (!deviceSerial) return;
        backendFetch(`/devices/${deviceSerial}/log`, { message: String(message.message ?? '') });
        break;

      default:
        ws.send(JSON.stringify({ type: 'error', message: `Tipo de mensaje desconocido: ${message.type}` }));
    }
  });

  ws.on('close', () => {
    if (isWatcher) { watchers.delete(ws); return; }
    if (deviceSerial) {
      const device = devices.get(deviceSerial);
      if (device) { device.ws = null; device.status = 'offline'; device.last_seen = Date.now(); syncDeviceStatus(deviceSerial, 'offline'); broadcast('device_offline', { serial_number: deviceSerial, name: device.name }); }
    }
  });

  ws.on('error', (e) => console.error(`[router] ws error ${deviceSerial}:`, e.message));
}

// ---------- Despacho de comandos (backend -> dispositivo) ----------
async function dispatchCommand(body) {
  const { serial_number, command, params } = body || {};
  if (!command) return { status: 400, json: { success: false, message: 'command es requerido' } };
  if (!serial_number) return { status: 400, json: { success: false, message: 'serial_number requerido' } };

  // 1) ¿Es un dispositivo ADB (USB)? -> ejecutar directo (Fase 3)
  if (adbTransport && adbTransport.has(serial_number)) {
    try {
      const result = await adbTransport.execute(serial_number, command, params || {});
      backendFetch(`/devices/${serial_number}/command-result`, {
        command_type: command, success: !!result.success, message: result.message, result_data: result.data ?? {},
      });
      broadcast('command_result', { serial_number, command, success: !!result.success });
      return { status: result.success ? 200 : 502, json: { success: !!result.success, message: result.message, data: result.data ?? null } };
    } catch (e) {
      return { status: 502, json: { success: false, message: `ADB error: ${e.message}` } };
    }
  }

  // 2) Dispositivo con agente por WebSocket -> enviar y esperar resultado
  const device = devices.get(serial_number);
  if (!device || device.ws?.readyState !== WebSocket.OPEN) {
    return { status: 404, json: { success: false, message: `Dispositivo ${serial_number} no conectado` } };
  }
  const id = randomUUID();
  const resultPromise = new Promise((resolve) => {
    const timer = setTimeout(() => { pendingCommands.delete(id); resolve({ success: false, message: `Timeout esperando ${command}` }); }, COMMAND_TIMEOUT_MS);
    pendingCommands.set(id, { resolve, timer });
  });
  device.ws.send(JSON.stringify({ type: 'command', id, command, params: params || {}, timestamp: new Date().toISOString() }));
  device.status = 'busy';
  const result = await resultPromise;
  return { status: result.success ? 200 : 502, json: { success: !!result.success, message: result.message, data: result.data ?? null } };
}

// ---------- Servidor HTTP + WebSocket ----------
function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 25 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

function start(config) {
  CONFIG = Object.assign(CONFIG, config);

  httpServer = http.createServer(async (req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

    if (req.method === 'GET' && req.url === '/health') {
      return send(200, { status: 'ok', connected_devices: devices.size, online: Array.from(devices.values()).filter(d => d.status === 'online').length });
    }
    if (req.method === 'GET' && req.url === '/devices/registry') {
      return send(200, { success: true, data: Array.from(devices.values()).map(({ ws, ...r }) => r) });
    }
    if (req.method === 'POST' && req.url === '/command/dispatch') {
      const body = await readJsonBody(req);
      const out = await dispatchCommand(body);
      return send(out.status, out.json);
    }
    send(404, { success: false, message: 'not found' });
  });

  wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  wss.on('connection', handleConnection);

  httpServer.listen(CONFIG.wsPort, '127.0.0.1', () => {
    console.log(`[router] escuchando en 127.0.0.1:${CONFIG.wsPort} (ws /ws, POST /command/dispatch)`);
  });

  // Limpieza de dispositivos "stale"
  setInterval(() => {
    const now = Date.now();
    for (const [serial, d] of devices.entries()) {
      if (d.status !== 'offline' && now - d.last_seen > 60000 && d.ws?.readyState !== WebSocket.OPEN) {
        d.status = 'offline'; syncDeviceStatus(serial, 'offline');
      }
    }
  }, 30000);
}

function stop() {
  try { wss?.close(); } catch (_) {}
  try { httpServer?.close(); } catch (_) {}
}

module.exports = { start, stop, setAdbTransport, devices, broadcast };
