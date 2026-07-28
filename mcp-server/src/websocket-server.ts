import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import axios from 'axios';
import { randomUUID } from 'crypto';

const app = express();
app.use(express.json({ limit: '20mb' })); // screenshots en base64
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ============================================================
// Configuration
// ============================================================

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000/api/v1';
const BACKEND_TOKEN = process.env.BACKEND_TOKEN || '';
const WS_PORT = parseInt(process.env.WS_PORT || '6001');
// Token compartido: los agentes lo mandan en 'register' y el backend en HTTP.
// Si está vacío no se exige (solo para desarrollo en red local aislada).
const WS_AUTH_TOKEN = process.env.WS_AUTH_TOKEN || '';
const COMMAND_TIMEOUT_MS = parseInt(process.env.COMMAND_TIMEOUT_MS || '60000');

const backend = axios.create({
    baseURL: BACKEND_URL,
    headers: BACKEND_TOKEN ? { Authorization: `Bearer ${BACKEND_TOKEN}` } : {},
    timeout: 15000,
});

// ============================================================
// State
// ============================================================

interface DeviceInfo {
    serial_number: string;
    name: string;
    model?: string;
    android_version?: string;
    status: 'online' | 'offline' | 'busy' | 'error';
    ws: WebSocket | null;
    last_seen: number;
    current_task?: string;
}

const devices = new Map<string, DeviceInfo>();
// Dashboards/observadores conectados al mismo WS con {type:'watch'}
const watchers = new Set<WebSocket>();
// Comandos en vuelo esperando command_result del agente
const pendingCommands = new Map<string, {
    resolve: (result: any) => void;
    timer: NodeJS.Timeout;
}>();

// ============================================================
// Health / registry API
// ============================================================

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        connected_devices: devices.size,
        online_devices: Array.from(devices.values()).filter(d => d.status === 'online').length,
    });
});

app.get('/devices/registry', requireHttpAuth, (req, res) => {
    const deviceList = Array.from(devices.values()).map(({ ws, ...rest }) => rest);
    res.json({ success: true, data: deviceList });
});

// ============================================================
// WebSocket protocol
//
// Agente -> servidor:
//   {type:'register', serial_number, token?, name?, model?, android_version?}
//   {type:'heartbeat', status?}
//   {type:'command_result', id, command, success, message?, data?}
//   {type:'screenshot', image}            (base64 PNG)
//   {type:'log_entry', message, level?}
// Servidor -> agente:
//   {type:'registered'} | {type:'error'} | {type:'heartbeat_ack'}
//   {type:'command', id, command, params}
// Dashboard -> servidor: {type:'watch'}   (recibe los broadcasts)
// ============================================================

wss.on('connection', (ws: WebSocket) => {
    let deviceSerial: string | null = null;
    let isWatcher = false;

    ws.on('message', (data) => {
        let message: any;
        try {
            message = JSON.parse(data.toString());
        } catch {
            return;
        }

        switch (message.type) {
            case 'watch':
                isWatcher = true;
                watchers.add(ws);
                ws.send(JSON.stringify({ type: 'watching' }));
                break;

            case 'register': {
                if (WS_AUTH_TOKEN && message.token !== WS_AUTH_TOKEN) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Token inválido' }));
                    ws.close();
                    return;
                }
                if (!message.serial_number) {
                    ws.send(JSON.stringify({ type: 'error', message: 'serial_number requerido' }));
                    return;
                }

                deviceSerial = message.serial_number as string;
                devices.set(deviceSerial, {
                    serial_number: deviceSerial,
                    name: message.name || `Dispositivo ${deviceSerial}`,
                    model: message.model,
                    android_version: message.android_version,
                    status: 'online',
                    ws,
                    last_seen: Date.now(),
                });

                registerDeviceWithBackend(message);

                ws.send(JSON.stringify({ type: 'registered', serial_number: deviceSerial }));
                broadcast('device_connected', { serial_number: deviceSerial, name: message.name });
                break;
            }

            case 'heartbeat': {
                if (!deviceSerial) return;
                const device = devices.get(deviceSerial);
                if (device) {
                    device.last_seen = Date.now();
                    device.status = message.status || 'online';
                    syncDeviceStatus(deviceSerial, device.status);
                }
                ws.send(JSON.stringify({ type: 'heartbeat_ack', timestamp: new Date().toISOString() }));
                break;
            }

            case 'command_result': {
                if (!deviceSerial) return;

                // Resolver el dispatch HTTP que espera este resultado
                const pending = message.id ? pendingCommands.get(message.id) : undefined;
                if (pending) {
                    clearTimeout(pending.timer);
                    pendingCommands.delete(message.id);
                    pending.resolve(message);
                }

                const device = devices.get(deviceSerial);
                if (device && device.status === 'busy') {
                    device.status = 'online';
                    device.current_task = undefined;
                }

                sendToBackend(`/devices/${deviceSerial}/command-result`, {
                    command_type: message.command || 'UNKNOWN',
                    success: !!message.success,
                    message: message.message,
                    result_data: message.data ?? {},
                });

                broadcast('command_result', {
                    serial_number: deviceSerial,
                    command: message.command,
                    success: message.success,
                });
                break;
            }

            case 'screenshot': {
                if (!deviceSerial || !message.image) return;
                sendToBackend(`/devices/${deviceSerial}/screenshot`, { image_data: message.image });
                broadcast('screenshot_received', { serial_number: deviceSerial });
                break;
            }

            case 'log_entry': {
                if (!deviceSerial) return;
                sendToBackend(`/devices/${deviceSerial}/log`, { message: String(message.message ?? '') });
                break;
            }

            default:
                ws.send(JSON.stringify({ type: 'error', message: `Tipo de mensaje desconocido: ${message.type}` }));
        }
    });

    ws.on('close', () => {
        if (isWatcher) {
            watchers.delete(ws);
            return;
        }
        if (deviceSerial) {
            const device = devices.get(deviceSerial);
            if (device) {
                device.ws = null;
                device.status = 'offline';
                device.last_seen = Date.now();
                syncDeviceStatus(deviceSerial, 'offline');
                broadcast('device_offline', { serial_number: deviceSerial, name: device.name });
            }
        }
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for ${deviceSerial}:`, error);
    });
});

// ============================================================
// Command dispatch (backend -> device)
//
// POST /command/dispatch
//   { serial_number, command, params }          -> espera el resultado del agente
//   { target_type: 'group'|'all_online', ... }  -> broadcast sin esperar
// ============================================================

function requireHttpAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!WS_AUTH_TOKEN) return next();
    const header = req.headers.authorization || '';
    if (header === `Bearer ${WS_AUTH_TOKEN}`) return next();
    res.status(401).json({ success: false, message: 'Token inválido' });
}

app.post('/command/dispatch', requireHttpAuth, async (req, res) => {
    const { serial_number, target_type, command, params } = req.body || {};

    if (!command) {
        return res.status(400).json({ success: false, message: 'command es requerido' });
    }

    // Caso principal: comando a un dispositivo concreto, esperando resultado
    if (serial_number) {
        const device = devices.get(serial_number);
        if (!device || device.ws?.readyState !== WebSocket.OPEN) {
            return res.status(404).json({
                success: false,
                message: `Dispositivo ${serial_number} no conectado al WS server`,
            });
        }

        const id = randomUUID();
        const resultPromise = new Promise<any>((resolve) => {
            const timer = setTimeout(() => {
                pendingCommands.delete(id);
                resolve({ success: false, message: `Timeout esperando resultado de ${command}` });
            }, COMMAND_TIMEOUT_MS);
            pendingCommands.set(id, { resolve, timer });
        });

        device.ws.send(JSON.stringify({
            type: 'command',
            id,
            command,
            params: params || {},
            timestamp: new Date().toISOString(),
        }));
        device.status = 'busy';

        const result = await resultPromise;
        return res.status(result.success ? 200 : 502).json({
            success: !!result.success,
            message: result.message,
            data: result.data ?? null,
        });
    }

    // Broadcast a grupo/todos (sin esperar resultados individuales)
    let targets: DeviceInfo[] = [];
    if (target_type === 'all_online') {
        targets = Array.from(devices.values())
            .filter(d => d.status === 'online' && d.ws?.readyState === WebSocket.OPEN);
    } else {
        return res.status(400).json({ success: false, message: 'serial_number o target_type=all_online requerido' });
    }

    let sent = 0;
    for (const device of targets) {
        try {
            device.ws?.send(JSON.stringify({
                type: 'command',
                id: randomUUID(),
                command,
                params: params || {},
                timestamp: new Date().toISOString(),
            }));
            sent++;
        } catch (error) {
            console.error(`Error enviando a ${device.serial_number}:`, error);
        }
    }

    res.json({ success: true, message: `Comando '${command}' enviado a ${sent} dispositivos`, sent });
});

// ============================================================
// Broadcast to watchers (dashboards)
// ============================================================

function broadcast(event: string, data: any) {
    const message = JSON.stringify({ type: event, ...data, timestamp: new Date().toISOString() });
    for (const client of watchers) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

// ============================================================
// Backend sync
// ============================================================

async function syncDeviceStatus(serial: string, status: string) {
    try {
        await backend.post('/devices/heartbeat', { serial_number: serial, status });
    } catch (error: any) {
        console.error('Error syncing with backend:', error.message);
    }
}

async function registerDeviceWithBackend(data: any) {
    try {
        await backend.post('/devices', {
            serial_number: data.serial_number,
            name: data.name,
            model: data.model,
            android_version: data.android_version,
            status: 'online',
        });
    } catch (error: any) {
        console.error('Error registering device with backend:', error.message);
    }
}

async function sendToBackend(endpoint: string, data: any) {
    try {
        await backend.post(endpoint, data);
    } catch (error: any) {
        console.error(`Error sending to ${endpoint}:`, error.message);
    }
}

// ============================================================
// Periodic cleanup - stale devices
// ============================================================

setInterval(() => {
    const now = Date.now();
    const STALE_TIMEOUT = 60000;

    for (const [serial, device] of devices.entries()) {
        if (device.status !== 'offline' && now - device.last_seen > STALE_TIMEOUT && device.ws?.readyState !== WebSocket.OPEN) {
            device.status = 'offline';
            syncDeviceStatus(serial, 'offline');
        }
    }
}, 30000);

// ============================================================
// Start
// ============================================================

server.listen(WS_PORT, () => {
    console.log(`\n========================================`);
    console.log(`  MCP WebSocket Server`);
    console.log(`  Puerto: ${WS_PORT} (path /ws)`);
    console.log(`  Backend: ${BACKEND_URL}`);
    console.log(`  Auth: ${WS_AUTH_TOKEN ? 'token requerido' : 'SIN TOKEN (solo desarrollo)'}`);
    console.log(`========================================\n`);
});

process.on('SIGINT', () => {
    console.log('\nApagando servidor...');
    wss.close();
    server.close(() => process.exit(0));
});
