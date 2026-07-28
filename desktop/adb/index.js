// Módulo ADB — control directo de teléfonos por USB, sin agente ni accesibilidad.
// - Detecta dispositivos conectados y los registra en el backend (transport='adb').
// - Traduce los mismos comandos de las rutinas a `adb shell` (tap, texto, captura…).
// Reproduce lo que el AccessibilityService del agente hace, pero desde el PC.

const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const maintenance = require('./maintenance');
let settings = null; try { settings = require('../server/settings'); } catch (_) {}
const HJ = (x, y) => settings ? settings.jitterXY(x, y) : { x, y };
const HD = (ms) => settings ? settings.varyDuration(ms) : ms;

let CONFIG = { backendUrl: 'http://127.0.0.1:8733/api/v1', backendToken: '', adbPath: null };
const live = new Map();       // adbSerial -> { serial, model, release, size:{w,h} }
let pollTimer = null;
let needsInitialReconciliation = true;

// ---------- localizar adb.exe ----------
function resolveAdb() {
  if (CONFIG.adbPath && fs.existsSync(CONFIG.adbPath)) return CONFIG.adbPath;
  const candidates = [
    process.env.ADB_PATH,
    process.resourcesPath && path.join(process.resourcesPath, 'platform-tools', 'adb.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe'),
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (_) {} }
  return 'adb'; // en PATH
}

// ---------- cola de concurrencia ADB ----------
// Cap de procesos adb.exe simultáneos: con 40+ dispositivos, lanzar decenas de
// spawns a la vez satura CPU/USB y bloquea el servidor adb. Las peticiones exceso
// esperan en cola. Prioridad: comandos interactivos > capturas de pantalla del muro.
const MAX_ADB = 14;
let activeAdb = 0;
const adbQueue = [];
function _execAdbRaw(args, { binary = false, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(resolveAdb(), args, { timeout, encoding: binary ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => err ? reject(err) : resolve(stdout));
  });
}
function _pumpAdb() {
  while (activeAdb < MAX_ADB && adbQueue.length) {
    const job = adbQueue.shift();
    activeAdb++;
    _execAdbRaw(job.args, job.opts).then(
      (r) => { activeAdb--; job.resolve(r); _pumpAdb(); },
      (e) => { activeAdb--; job.reject(e); _pumpAdb(); },
    );
  }
}
function adb(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const job = { args, opts, resolve, reject };
    if (opts.lowPriority) adbQueue.push(job); else adbQueue.unshift(job);
    _pumpAdb();
  });
}
function adbStats() { return { active: activeAdb, queued: adbQueue.length, max: MAX_ADB }; }
function shell(serial, cmd, opts) { return adb(['-s', serial, 'shell', ...cmd], opts); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function backendPost(endpoint, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (CONFIG.backendToken) headers['Authorization'] = `Bearer ${CONFIG.backendToken}`;
  try { await fetch(CONFIG.backendUrl + endpoint, { method: 'POST', headers, body: JSON.stringify(data) }); }
  catch (e) { console.error('[adb] backend', endpoint, e.message); }
}

async function backendGet(endpoint) {
  const headers = {};
  if (CONFIG.backendToken) headers['Authorization'] = `Bearer ${CONFIG.backendToken}`;
  try { const r = await fetch(CONFIG.backendUrl + endpoint, { headers }); return await r.json(); }
  catch (e) { return null; }
}

// Reaplica el proxy guardado del dispositivo (si está activo) tras (re)conectarse,
// para que la IP de salida se mantenga entre reinicios/desconexiones.
async function reapplyProxy(serial) {
  try {
    const res = await backendGet(`/devices/${encodeURIComponent(serial)}`);
    const dev = res && res.data && (res.data.device || res.data);
    if (dev && dev.proxy_enabled && dev.proxy_host && dev.proxy_port) {
      await execute(serial, 'SET_PROXY', { host: dev.proxy_host, port: dev.proxy_port, user: dev.proxy_user });
      console.log(`[adb] proxy reaplicado a ${serial}: ${dev.proxy_host}:${dev.proxy_port}`);
    }
  } catch (_) {}
}

async function screenSize(serial) {
  const dev = live.get(serial);
  if (dev?.size) return dev.size;
  try {
    const out = await shell(serial, ['wm', 'size']);
    const m = out.match(/(\d+)x(\d+)/);
    const size = m ? { w: +m[1], h: +m[2] } : { w: 1080, h: 1920 };
    if (dev) dev.size = size;
    return size;
  } catch { return { w: 1080, h: 1920 }; }
}

// ---------- detección / registro ----------
async function listDevices() {
  const out = await adb(['devices']).catch(() => '');
  return out.split(/\r?\n/).slice(1)
    .map(l => l.trim()).filter(Boolean)
    .map(l => l.split(/\s+/))
    .filter(p => p[1] === 'device')      // ignora unauthorized/offline
    .map(p => p[0]);
}

async function registerDevice(serial) {
  let model = 'USB device', release = 'unknown';
  try { model = (await shell(serial, ['getprop', 'ro.product.model'])).trim() || model; } catch (_) {}
  try { release = (await shell(serial, ['getprop', 'ro.build.version.release'])).trim() || release; } catch (_) {}
  live.set(serial, { serial, model, release, size: null });
  await backendPost('/devices', {
    serial_number: serial, adb_serial: serial, transport: 'adb',
    name: `${model} (USB)`, model, android_version: release, status: 'online',
  });
  console.log(`[adb] dispositivo USB registrado: ${serial} (${model})`);
  try { const router = require('../router'); router.broadcast('device_connected', { serial_number: serial, name: model }); } catch (_) {}
  reapplyProxy(serial);
  applyStability(serial);   // estabilidad inmediata al conectar
  applyTimeConfig(serial);  // hora/fecha estable al conectar
}

// Aplica al instante la base de estabilidad: mantener el teléfono despierto mientras
// carga (evita que se duerma/desconecte durante la operación de granja).
async function applyStability(serial) {
  try {
    await shell(serial, ['settings', 'put', 'global', 'stay_on_while_plugged_in', '7']); // AC+USB+Wireless
    await shell(serial, ['svc', 'power', 'stayon', 'true']).catch(() => {});
    console.log(`[adb] estabilidad aplicada a ${serial} (mantener despierto)`);
  } catch (_) {}
}

// Estabiliza hora/fecha al conectar. Si el dispositivo tiene una zona horaria fija
// guardada (para cuadrar con su proxy), la aplica; si no, activa hora+zona automáticas.
async function applyTimeConfig(serial) {
  try {
    const res = await backendGet(`/devices/${encodeURIComponent(serial)}`);
    const dev = res && res.data && (res.data.device || res.data);
    if (dev && dev.timezone) {
      await execute(serial, 'SET_TIMEZONE', { timezone: dev.timezone });
      console.log(`[adb] zona horaria aplicada a ${serial}: ${dev.timezone}`);
    } else {
      await execute(serial, 'SET_TIME_AUTO', { enabled: true });
      console.log(`[adb] hora automática activada en ${serial}`);
    }
  } catch (_) {}
}

async function poll() {
  let serials = [];
  try { serials = await listDevices(); } catch (_) {}
  // nuevos
  for (const s of serials) if (!live.has(s)) await registerDevice(s);
  // Al arrancar, la memoria `live` está vacía. Sin esta reconciliación, los
  // dispositivos ADB desconectados conservarían indefinidamente el estado
  // online persistido por la sesión anterior.
  if (needsInitialReconciliation) {
    const response = await backendGet('/devices?per_page=200');
    const persisted = response?.data?.data || (Array.isArray(response?.data) ? response.data : null);
    if (Array.isArray(persisted)) {
      for (const device of persisted) {
        if (device.transport === 'adb' && !serials.includes(device.adb_serial || device.serial_number)) {
          await backendPost('/devices/heartbeat', {
            serial_number: device.serial_number,
            status: 'offline',
          });
        }
      }
      needsInitialReconciliation = false;
    }
  }
  // desconectados
  for (const s of [...live.keys()]) {
    if (!serials.includes(s)) {
      live.delete(s);
      await backendPost('/devices/heartbeat', { serial_number: s, status: 'offline' });
      console.log(`[adb] dispositivo USB desconectado: ${s}`);
      try { const router = require('../router'); router.broadcast('device_offline', { serial_number: s }); } catch (_) {}
    }
  }
}

// ---------- traductor de comandos ----------
async function dumpUi(serial) {
  await shell(serial, ['uiautomator', 'dump', '/sdcard/mcp_ui.xml']).catch(() => {});
  return shell(serial, ['cat', '/sdcard/mcp_ui.xml']).catch(() => '');
}

function findBoundsBy(xml, attr, value) {
  // busca el primer nodo cuyo attr contiene value y devuelve el centro de sus bounds
  const re = new RegExp(`<node[^>]*\\b${attr}="[^"]*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, 'i');
  const m = xml.match(re);
  if (!m) return null;
  return { x: Math.round((+m[1] + +m[3]) / 2), y: Math.round((+m[2] + +m[4]) / 2) };
}

async function tapText(serial, text) {
  const xml = await dumpUi(serial);
  const b = findBoundsBy(xml, 'text', text) || findBoundsBy(xml, 'content-desc', text);
  if (!b) return { success: false, message: `No encontrado por texto: ${text}` };
  const j = HJ(b.x, b.y);
  await shell(serial, ['input', 'tap', String(j.x), String(j.y)]);
  return { success: true, message: `Tap en '${text}'` };
}
async function tapId(serial, id) {
  const xml = await dumpUi(serial);
  const b = findBoundsBy(xml, 'resource-id', id);
  if (!b) return { success: false, message: `No encontrado por id: ${id}` };
  const j = HJ(b.x, b.y);
  await shell(serial, ['input', 'tap', String(j.x), String(j.y)]);
  return { success: true, message: `Tap en id '${id}'` };
}

async function execute(serial, command, params) {
  const p = params || {};
  try {
    switch (command) {
      case 'OPEN_APP':
        await shell(serial, ['monkey', '-p', p.package_name, '-c', 'android.intent.category.LAUNCHER', '1']);
        await sleep(2000);
        return { success: true, message: `App abierta: ${p.package_name}` };

      case 'GOTO_URL':
        await shell(serial, ['am', 'start', '-a', 'android.intent.action.VIEW', '-d', p.url]);
        await sleep(2000);
        return { success: true, message: `URL abierta: ${p.url}` };

      case 'CLICK_BY_TEXT':
        return await tapText(serial, String(p.text ?? ''));

      case 'CLICK_BY_ID':
        return await tapId(serial, String(p.resource_id ?? ''));

      case 'SET_TEXT': {
        if (p.resource_id) { const t = await tapId(serial, String(p.resource_id)); if (!t.success) return t; }
        await sleep(300);
        const value = String(p.value ?? '').replace(/ /g, '%s');
        await shell(serial, ['input', 'text', value]);
        return { success: true, message: 'Texto escrito' };
      }

      case 'SCROLL': {
        const s = await screenSize(serial);
        const cxj = HJ(Math.round(s.w / 2), 0).x;
        const down = (p.direction || 'down') !== 'up';
        const y1 = down ? Math.round(s.h * 0.7) : Math.round(s.h * 0.3);
        const y2 = down ? Math.round(s.h * 0.3) : Math.round(s.h * 0.7);
        await shell(serial, ['input', 'swipe', String(cxj), String(y1), String(cxj), String(y2), String(HD(300))]);
        return { success: true, message: `Scroll ${p.direction || 'down'}` };
      }

      case 'SWIPE':
        await shell(serial, ['input', 'swipe', String(p.start_x ?? 300), String(p.start_y ?? 1000), String(p.end_x ?? 300), String(p.end_y ?? 400), String(HD(300))]);
        return { success: true, message: 'Swipe' };

      case 'PRESS_BACK':
        await shell(serial, ['input', 'keyevent', '4']); return { success: true, message: 'Back' };
      case 'PRESS_HOME':
        await shell(serial, ['input', 'keyevent', '3']); return { success: true, message: 'Home' };

      case 'PLAY_MEDIA':
        await sleep((p.duration_seconds ?? 30) * 1000);
        return { success: true, message: `Reproducido ${p.duration_seconds ?? 30}s` };

      case 'PAUSE_MEDIA': {
        const s = await screenSize(serial);
        await shell(serial, ['input', 'tap', String(Math.round(s.w / 2)), String(Math.round(s.h / 2))]);
        return { success: true, message: 'Pausa (tap central)' };
      }

      case 'WAIT':
      case 'TYPING_DELAY':
        await sleep(Math.min(p.duration ?? 1000, 60000));
        return { success: true, message: `Espera ${p.duration ?? 1000}ms` };

      case 'WAIT_FOR_ELEMENT': {
        const timeout = (p.timeout_ms ?? 10000);
        const start = Date.now();
        const needleText = p.text, needleId = p.resource_id;
        while (Date.now() - start < timeout) {
          const xml = await dumpUi(serial);
          if ((needleText && (findBoundsBy(xml, 'text', String(needleText)) || findBoundsBy(xml, 'content-desc', String(needleText)))) ||
              (needleId && findBoundsBy(xml, 'resource-id', String(needleId)))) {
            return { success: true, message: 'Elemento encontrado' };
          }
          await sleep(500);
        }
        return { success: false, message: 'Timeout esperando elemento' };
      }

      case 'CAPTURE_SCREEN': {
        const png = await adb(['-s', serial, 'exec-out', 'screencap', '-p'], { binary: true });
        const b64 = Buffer.from(png).toString('base64');
        await backendPost(`/devices/${serial}/screenshot`, { image_data: b64 });
        return { success: true, message: 'Captura tomada', data: { image: b64, bytes: png.length } };
      }

      case 'REPORT_RESULT':
        return { success: true, message: 'Resultado reportado' };

      case 'KEEP_AWAKE':
        await applyStability(serial);
        return { success: true, message: 'Mantener despierto activado' };

      case 'SET_TIME_AUTO': {
        // Hora/fecha automática por red (evita relojes desfasados que rompen HTTPS/logins).
        const on = p.enabled === false ? '0' : '1';
        await shell(serial, ['settings', 'put', 'global', 'auto_time', on]);
        await shell(serial, ['settings', 'put', 'global', 'auto_time_zone', on]);
        return { success: true, message: on === '1' ? 'Hora automática activada' : 'Hora automática desactivada' };
      }

      case 'SET_TIMEZONE': {
        // Zona horaria fija (para cuadrar con la IP/proxy). Desactiva auto_time_zone
        // para que la red no la sobrescriba, pero deja auto_time (reloj correcto).
        const tz = String(p.timezone || p.tz || '').trim();
        if (!tz) return { success: false, message: 'Zona horaria requerida' };
        await shell(serial, ['settings', 'put', 'global', 'auto_time', '1']);
        await shell(serial, ['settings', 'put', 'global', 'auto_time_zone', '0']);
        // Varias vías según versión/permisos de Android:
        await shell(serial, ['service', 'call', 'alarm', '3', 's16', tz]).catch(() => {});
        await shell(serial, ['cmd', 'time_zone_detector', 'set_time_zone_state_for_tests', tz, 'true']).catch(() => {});
        await shell(serial, ['setprop', 'persist.sys.timezone', tz]).catch(() => {});
        const cur = (await shell(serial, ['getprop', 'persist.sys.timezone']).catch(() => '')).trim();
        const ok = cur === tz;
        return { success: true, message: ok ? `Zona horaria: ${tz}` : `Zona horaria solicitada: ${tz} (actual: ${cur || 'desconocida'})`, data: { timezone: cur || tz, applied: ok } };
      }

      case 'GET_TIME': {
        const date = (await shell(serial, ['date'])).trim();
        const tz = (await shell(serial, ['getprop', 'persist.sys.timezone']).catch(() => '')).trim();
        return { success: true, message: `Hora: ${date}`, data: { date, timezone: tz } };
      }

      // ---- Proxy / IP de salida por dispositivo ----
      case 'SET_PROXY': {
        if (p.user || p.username || p.password) {
          return { success: false, message: 'Android por ADB no admite autenticación en el proxy HTTP global' };
        }
        return maintenance.setProxy(serial, p, shell);
      }

      case 'CLEAR_PROXY':
        return maintenance.clearProxy(serial, shell);

      case 'GET_PROXY':
      case 'DEVICE_NETWORK_STATUS':
        return maintenance.getNetworkStatus(serial, shell);

      case 'DEVICE_STABILIZE':
        return maintenance.stabilizeDevice(serial, p, shell);

      case 'DEVICE_HEALTH': {
        // Batería, temperatura, carga y almacenamiento libre.
        let battery = null, tempC = null, charging = null, freeMb = null;
        try {
          const bat = await shell(serial, ['dumpsys', 'battery']);
          const lvl = bat.match(/level:\s*(\d+)/); if (lvl) battery = +lvl[1];
          const tmp = bat.match(/temperature:\s*(\d+)/); if (tmp) tempC = +tmp[1] / 10; // décimas de grado
          const st = bat.match(/status:\s*(\d+)/); if (st) charging = (st[1] === '2' || st[1] === '5') ? 1 : 0; // 2=charging,5=full
        } catch (_) {}
        try {
          const df = await shell(serial, ['df', '/data']);
          const line = df.trim().split(/\r?\n/).pop();
          const cols = line.trim().split(/\s+/);
          // "Available" suele ser la 4ª columna en KB (o con sufijo). Buscamos un valor con K/M/G.
          const avail = cols.find(c => /^[\d.]+[KMG]?$/.test(c) && cols.indexOf(c) >= 3);
          if (avail) {
            const num = parseFloat(avail);
            freeMb = /G$/.test(avail) ? Math.round(num * 1024) : /K$/.test(avail) ? Math.round(num / 1024) : /M$/.test(avail) ? Math.round(num) : Math.round(num / 1024);
          }
        } catch (_) {}
        return { success: true, message: `Batería ${battery}% · ${tempC}°C`, data: { battery, temperature_c: tempC, charging, storage_free_mb: freeMb } };
      }

      case 'READ_SCREEN_TEXT': {
        // Devuelve todo el texto visible (text= y content-desc=) del volcado de UI,
        // para que el monitor busque señales de baneo/captcha/verificación.
        const xml = await dumpUi(serial);
        const texts = [];
        const re = /(?:text|content-desc)="([^"]*)"/g; let m;
        while ((m = re.exec(xml))) { const s = m[1].trim(); if (s) texts.push(s); }
        const uniq = [...new Set(texts)];
        return { success: true, message: `Texto leído (${uniq.length} elementos)`, data: { text: uniq.join(' | '), items: uniq } };
      }

      case 'CHECK_IP': {
        // Intenta la IP externa desde el propio dispositivo (a través de su proxy si lo tiene).
        let ip = '', method = '';
        try { ip = (await shell(serial, ['curl', '-s', '--max-time', '8', 'https://api.ipify.org'], { timeout: 12000 })).trim(); method = 'curl'; } catch (_) {}
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
          try { ip = (await shell(serial, ['toybox', 'wget', '-qO-', 'http://api.ipify.org'], { timeout: 12000 })).trim(); method = 'toybox'; } catch (_) {}
        }
        const proxy = (await shell(serial, ['settings', 'get', 'global', 'http_proxy']).catch(() => '')).trim();
        let localIp = '';
        try { const m = (await shell(serial, ['ip', 'route'])).match(/src (\d+\.\d+\.\d+\.\d+)/); localIp = m ? m[1] : ''; } catch (_) {}
        const ok = /^\d+\.\d+\.\d+\.\d+$/.test(ip);
        return {
          success: true,
          message: ok ? `IP externa: ${ip}` : (localIp ? `IP local: ${localIp} (externa no disponible; falta curl/wget)` : 'No se pudo obtener IP'),
          data: { external_ip: ok ? ip : null, local_ip: localIp || null, proxy: (proxy && proxy !== ':0' && proxy !== 'null') ? proxy : null, method },
        };
      }

      // ---- Utilidades ADB (catálogo de herramientas para granja de teléfonos) ----
      case 'TAP_XY': {
        const j = HJ(Number(p.x ?? 0), Number(p.y ?? 0));
        await shell(serial, ['input', 'tap', String(j.x), String(j.y)]);
        return { success: true, message: `Tap en (${j.x},${j.y})` };
      }

      case 'INPUT_KEYEVENT':
        await shell(serial, ['input', 'keyevent', String(p.keycode ?? '4')]);
        return { success: true, message: `Keyevent ${p.keycode}` };

      case 'TYPE_TEXT':
        await shell(serial, ['input', 'text', String(p.value ?? '').replace(/ /g, '%s')]);
        return { success: true, message: 'Texto escrito' };

      case 'OPEN_APP':
        await shell(serial, ['monkey', '-p', String(p.packageName || p.package_name || 'com.spotify.music'), '-c', 'android.intent.category.LAUNCHER', '1']);
        return { success: true, message: `App ${p.packageName || p.package_name} abierta` };

      case 'GOTO_URL':
        await shell(serial, ['am', 'start', '-a', 'android.intent.action.VIEW', '-d', String(p.url ?? '')]);
        await sleep(1200);
        return { success: true, message: `URL/URI ${p.url} abierta` };

      case 'START_ACTIVITY':
        await shell(serial, ['am', 'start', '-n', String(p.component ?? '')]);
        await sleep(1500);
        return { success: true, message: `Actividad ${p.component}` };

      case 'FORCE_STOP':
        await shell(serial, ['am', 'force-stop', String(p.package_name ?? '')]);
        return { success: true, message: `Detenida ${p.package_name}` };

      case 'CLEAR_APP':
        await shell(serial, ['pm', 'clear', String(p.package_name ?? '')]);
        return { success: true, message: `Datos borrados ${p.package_name}` };

      case 'UNINSTALL_APP':
        await shell(serial, ['pm', 'uninstall', String(p.package_name ?? '')]);
        return { success: true, message: `Desinstalada ${p.package_name}` };

      case 'INSTALL_APK': {
        const out = await adb(['-s', serial, 'install', '-r', String(p.apk_path ?? '')], { timeout: 180000 });
        const ok = /Success/i.test(out || '');
        return { success: ok, message: ok ? 'APK instalado' : `Fallo al instalar: ${String(out).slice(0, 120)}` };
      }

      case 'GRANT_PERMISSION':
        await shell(serial, ['pm', 'grant', String(p.package_name ?? ''), String(p.permission ?? '')]);
        return { success: true, message: `Permiso concedido: ${p.permission}` };

      case 'SETTINGS_PUT':
        await shell(serial, ['settings', 'put', String(p.namespace ?? 'system'), String(p.key ?? ''), String(p.value ?? '')]);
        return { success: true, message: `settings ${p.namespace}.${p.key}=${p.value}` };

      case 'SETTINGS_GET': {
        const val = (await shell(serial, ['settings', 'get', String(p.namespace ?? 'system'), String(p.key ?? '')])).trim();
        return { success: true, message: `${p.key}=${val}`, data: { value: val } };
      }

      case 'SCREEN_ON':
        await shell(serial, ['input', 'keyevent', '224']); // WAKEUP
        return { success: true, message: 'Pantalla encendida' };

      case 'SCREEN_OFF':
        await shell(serial, ['input', 'keyevent', '223']); // SLEEP
        return { success: true, message: 'Pantalla apagada' };

      case 'PRESS_HOME':
        await shell(serial, ['input', 'keyevent', '3']); // KEYCODE_HOME
        return { success: true, message: 'Botón Inicio enviado' };

      case 'PRESS_BACK':
        await shell(serial, ['input', 'keyevent', '4']); // KEYCODE_BACK
        return { success: true, message: 'Botón Atrás enviado' };

      case 'UNLOCK':
        await shell(serial, ['input', 'keyevent', '224']);
        await sleep(300);
        await shell(serial, ['input', 'keyevent', '82']); // MENU (desbloqueo simple sin PIN)
        return { success: true, message: 'Desbloqueo intentado' };

      case 'REBOOT':
        await adb(['-s', serial, 'reboot']);
        return { success: true, message: 'Reiniciando dispositivo' };

      case 'MONKEY': {
        const args = ['monkey', '-p', String(p.package_name ?? '')];
        if (p.throttle) args.push('--throttle', String(p.throttle));
        args.push('-v', String(p.events ?? 200));
        await shell(serial, args, { timeout: 120000 });
        return { success: true, message: `Monkey ${p.events ?? 200} eventos en ${p.package_name}` };
      }

      case 'PUSH_FILE':
        await adb(['-s', serial, 'push', String(p.local ?? ''), String(p.remote ?? '')], { timeout: 180000 });
        return { success: true, message: `Enviado ${p.local} → ${p.remote}` };

      case 'PULL_FILE':
        await adb(['-s', serial, 'pull', String(p.remote ?? ''), String(p.local ?? '')], { timeout: 180000 });
        return { success: true, message: `Descargado ${p.remote} → ${p.local}` };

      case 'SCREEN_RECORD': {
        const secs = Math.min(p.duration_seconds ?? 10, 180);
        const remote = '/sdcard/mcp_rec.mp4';
        await shell(serial, ['screenrecord', '--time-limit', String(secs), remote], { timeout: (secs + 20) * 1000 });
        const dir = path.join(require('os').tmpdir(), 'mcp-recordings');
        fs.mkdirSync(dir, { recursive: true });
        const local = path.join(dir, `${serial}_${Date.now()}.mp4`);
        await adb(['-s', serial, 'pull', remote, local], { timeout: 60000 });
        return { success: true, message: `Grabación ${secs}s`, data: { file: local } };
      }

      default:
        return { success: false, message: `Comando no soportado por ADB: ${command}` };
    }
  } catch (e) {
    return { success: false, message: `ADB error en ${command}: ${e.message}` };
  }
}

const frameCache = new Map();

// Comprime el frame del muro: reescala a un ancho máximo y lo pasa a JPEG con
// nativeImage de Electron (sin dependencias nativas). Un PNG de pantalla completa
// (2-8 MB) baja a ~30-80 KB de JPEG, aliviando CPU/USB con muchos dispositivos.
// Si nativeImage no está disponible (o falla), devuelve el PNG original.
function compressFrame(png, maxW, quality) {
  try {
    const { nativeImage } = require('electron');
    let img = nativeImage.createFromBuffer(png);
    const size = img.getSize();
    if (size.width > maxW) img = img.resize({ width: maxW, quality: 'good' });
    const jpeg = img.toJPEG(quality);
    if (jpeg && jpeg.length > 0 && jpeg.length < png.length) {
      return { buf: jpeg, mime: 'image/jpeg' };
    }
  } catch (_) {}
  return { buf: png, mime: 'image/png' };
}

// opts.thumb = true → miniatura para el muro (más pequeña/ligera). Sin thumb =
// calidad alta para el teléfono enfocado. Se cachea por (serial, modo).
async function captureFrame(device, opts = {}) {
  const serial = device.adb_serial || device.serial_number;
  const thumb = !!opts.thumb;
  const maxW = thumb ? (CONFIG.thumbMaxWidth || 240) : (CONFIG.frameMaxWidth || 480);
  const quality = thumb ? (CONFIG.thumbQuality || 40) : (CONFIG.frameQuality || 60);
  const key = serial + (thumb ? ':t' : ':f');
  const cached = frameCache.get(key);
  const now = Date.now();
  // caché más largo para miniaturas del muro (menos refrescos con 40 dispositivos)
  const ttl = thumb ? (CONFIG.thumbTtlMs || 1500) : 300;
  if (cached && (now - cached.ts < ttl)) {
    return { success: true, image: cached.image, mime: cached.mime, source: cached.source, cached: true };
  }
  try {
    const png = await adb(['-s', serial, 'exec-out', 'screencap', '-p'], { binary: true, timeout: 15000, lowPriority: true });
    if (!png || png.length < 100) {
      if (cached) return { success: true, image: cached.image, mime: cached.mime, source: cached.source };
      return { success: false, message: 'Captura ADB vacía' };
    }
    const { buf, mime } = compressFrame(Buffer.from(png), maxW, quality);
    const b64 = Buffer.from(buf).toString('base64');
    frameCache.set(key, { image: b64, mime, source: 'adb', ts: now });
    return { success: true, image: b64, mime, source: 'adb' };
  } catch (e) {
    if (cached) return { success: true, image: cached.image, mime: cached.mime, source: cached.source };
    return { success: false, message: `Error de pantalla ADB: ${e.message}` };
  }
}

async function connectTcp(address) {
  let target = String(address || '').trim();
  if (!target) return { success: false, message: 'Dirección TCP requerida' };
  if (!target.includes(':')) target += ':5555';
  try {
    const out = await adb(['connect', target], { timeout: 15000 });
    const ok = /connected/i.test(out || '');
    poll();
    return { success: ok, message: ok ? `Dispositivo TCP conectado exitosamente: ${target}` : `ADB: ${out}` };
  } catch (e) {
    return { success: false, message: `Error conectando TCP: ${e.message}` };
  }
}

// ---------- API pública para el router ----------
function has(serial) { return live.has(serial); }

function start(config) {
  CONFIG = Object.assign(CONFIG, config);
  needsInitialReconciliation = true;
  console.log(`[adb] usando adb: ${resolveAdb()}`);
  poll();
  pollTimer = setInterval(poll, 1500);
}
function stop() { if (pollTimer) clearInterval(pollTimer); }

module.exports = { start, stop, has, execute, captureFrame, connectTcp, live, adbStats };
