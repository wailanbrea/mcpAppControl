// MCP AppControl — proceso principal de Electron.
// Orquesta: backend Node.js (SQLite sql.js) + Command Router (WebSocket) + ADB + Dashboard.

const { app, BrowserWindow, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dbServer = require('./server/db');
const logic = require('./server/logic');
const appServer = require('./server/app');
const alerts = require('./server/alerts');
const monitor = require('./server/monitor');
const accounts = require('./server/accounts');
const proxies = require('./server/proxies');
const hermes = require('./server/hermes');
const settings = require('./server/settings');
const views = require('./server/views');
const router = require('./router');
const adb = require('./adb');

const HTTP_PORT = 8733;      // puerto local del backend Express embebido
const WS_PORT = 6011;        // puerto del Command Router (WebSocket)

let win = null;
let apiToken = '';
let scheduleInterval = null;
let pruneInterval = null;
let monitorInterval = null;
let database = null;
let httpServer = null;

function userFile(name) {
  return path.join(app.getPath('userData'), name);
}

function dbPath() {
  return userFile('appcontrol.sqlite');
}

function loadApiToken() {
  const tokenFile = userFile('api-token.txt');
  try {
    const stored = fs.readFileSync(tokenFile, 'utf8').trim();
    if (stored.length >= 32) return stored;
  } catch (_) {}

  const generated = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  fs.writeFileSync(tokenFile, generated, { encoding: 'utf8', mode: 0o600 });
  return generated;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 860,
    title: 'MCP Control Bsolutions V1',
    backgroundColor: '#0f1117',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  // Elimina cualquier Service Worker/caché heredado de la versión PWA anterior
  // que interceptaba las llamadas a la API (dejaba la lista de dispositivos vacía).
  session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] })
    .catch(() => {})
    .finally(() => win.loadURL(`http://127.0.0.1:${HTTP_PORT}/`));

  // Inyecta el token y la config local para que el dashboard funcione sin
  // que el usuario pegue nada.
  win.webContents.on('did-finish-load', async () => {
    const js = `(() => {
      const t = ${JSON.stringify(apiToken)};
      let changed = localStorage.getItem('mcp_api_token') !== t;
      localStorage.setItem('mcp_api_token', t);
      localStorage.setItem('mcp_api_base', location.origin);
      localStorage.setItem('mcp_ws_host', '127.0.0.1:${WS_PORT}');
      if (changed) location.reload();
    })();`;
    try { await win.webContents.executeJavaScript(js); } catch (_) {}
  });

  win.on('closed', () => { win = null; });
}

// Una sola instancia: evita que un segundo arranque intente enlazar el puerto
// 8733 (fallaría y dejaría la app sin backend / sin dispositivos).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

app.whenReady().then(async () => {
  try {
    apiToken = loadApiToken();

    // 1. Abrir base de datos SQLite (motor nativo better-sqlite3; fallback a sql.js)
    const db = await dbServer.open(dbPath());
    database = db;
    console.log(`[db] motor de almacenamiento: ${db.engine || 'sql.js'}`);

    // 2. Inicializar lógica de negocio y despacho
    logic.init(db, WS_PORT);
    alerts.init(db);
    accounts.init(db);
    proxies.init(db, {
      encrypt: accounts._enc,
      decrypt: accounts._dec,
      dispatch: logic.routerDispatch,
    });
    hermes.init({
      nodeRuntimePath: app.isPackaged
        ? path.join(process.resourcesPath, 'node-runtime', 'node.exe')
        : path.resolve(__dirname, 'node_modules', 'node', 'bin', 'node.exe'),
      mcpServerPath: app.isPackaged
        ? path.join(process.resourcesPath, 'mcp-server', 'appcontrol-mcp.cjs')
        : path.resolve(__dirname, '..', 'mcp-server', 'bundle', 'appcontrol-mcp.cjs'),
      tokenFile: userFile('api-token.txt'),
      backendUrl: `http://127.0.0.1:${HTTP_PORT}/api/v1`,
    });
    settings.init(db);
    monitor.init(db, { dispatch: logic.routerDispatch });
    views.init(db);

    // 3. Arrancar servidor Express (API REST /api/v1 + UI Dashboard)
    const serverApp = appServer.createServer(db, WS_PORT, apiToken);
    await new Promise((resolve, reject) => {
      httpServer = serverApp.listen(HTTP_PORT, '127.0.0.1', () => {
        console.log(`[backend] Servidor Express corriendo en http://127.0.0.1:${HTTP_PORT}`);
        resolve();
      });
      httpServer.on('error', reject);
    });

    // 4. Iniciar runner de horarios (cron tick cada 30 segundos)
    scheduleInterval = setInterval(() => {
      try { logic.scheduleTick(); } catch (e) { console.error('[scheduleTick]', e.message); }
    }, 30000);

    // 4b. Poda de logs antiguos (> 7 días): al arrancar y cada 6 horas, para que
    // la BD no crezca sin límite y cada guardado sea rápido.
    const prune = () => { try { const n = dbServer.pruneLogs(db, 7); if (n) console.log(`[prune] ${n} logs antiguos eliminados`); } catch (e) { console.error('[prune]', e.message); } };
    prune();
    pruneInterval = setInterval(prune, 6 * 3600 * 1000);

    // 4c. Monitor de baneo/captcha (opt-in): revisa la pantalla de cada dispositivo
    // según el intervalo configurado en alerts-config.json (monitor_enabled).
    monitorInterval = setInterval(() => {
      try {
        const cfg = alerts.raw();
        if (!cfg.monitor_enabled) return;
        if (!monitorInterval._nextTs || Date.now() >= monitorInterval._nextTs) {
          monitorInterval._nextTs = Date.now() + Math.max(30, cfg.monitor_interval_sec || 120) * 1000;
          monitor.tick();
        }
      } catch (e) { console.error('[monitor]', e.message); }
      // Salud de hardware (batería/temp/almacenamiento) según su propio intervalo.
      try {
        const s = settings.get();
        if (s.hw_enabled && (!monitorInterval._hwTs || Date.now() >= monitorInterval._hwTs)) {
          monitorInterval._hwTs = Date.now() + Math.max(60, s.hw_interval_sec || 300) * 1000;
          monitor.healthTick();
        }
      } catch (e) { console.error('[healthTick]', e.message); }
    }, 15000);

    // 5. Command Router: puente con agentes (WebSocket)
    const backendApi = `http://127.0.0.1:${HTTP_PORT}/api/v1`;
    router.start({
      wsPort: WS_PORT,
      backendUrl: backendApi,
      backendToken: apiToken,
      wsAuthToken: '',
    });

    // 6. Transporte ADB: detecta teléfonos por USB y los controla directamente.
    //    frameMaxWidth/frameQuality = streaming ligero del muro (JPEG reescalado).
    adb.start({
      backendUrl: backendApi, backendToken: apiToken,
      frameMaxWidth: 480, frameQuality: 60,      // visor enfocado (alta calidad)
      thumbMaxWidth: 240, thumbQuality: 40, thumbTtlMs: 1500,  // miniaturas del muro (ligeras, escala 40+)
    });
    router.setAdbTransport(adb);

    // 7. Crear ventana principal
    createWindow();
  } catch (err) {
    dialog.showErrorBox('MCP AppControl', 'No se pudo iniciar la aplicación:\n' + err.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (scheduleInterval) clearInterval(scheduleInterval);
  if (pruneInterval) clearInterval(pruneInterval);
  if (monitorInterval) clearInterval(monitorInterval);
  adb.stop();
  router.stop();
  if (httpServer) httpServer.close();
  if (database) database.close();
  app.quit();
});
