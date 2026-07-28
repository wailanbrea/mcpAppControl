// Servidor Express embebido (reemplazo total de PHP/Laravel)
const express = require('express');
const path = require('path');
const fs = require('fs');
const { now } = require('./db');
const logic = require('./logic');
const adb = require('../adb');
const alerts = require('./alerts');
const monitor = require('./monitor');
const accounts = require('./accounts');
const proxies = require('./proxies');
const hermes = require('./hermes');
const settings = require('./settings');
const views = require('./views');
const crypto = require('crypto');
let router = null; try { router = require('../router'); } catch (_) {}
// Notifica a los dashboards (watchers WS) que la lista/estado de dispositivos cambió,
// para que refresquen al instante en vez de esperar al siguiente sondeo.
const pushDevicesChanged = () => { try { router && router.broadcast && router.broadcast('devices_changed', {}); } catch (_) {} };

function paginate(items, requestedPage = 1, requestedPageSize = 50) {
  const total = items.length;
  const perPage = Math.min(200, Math.max(1, Number.parseInt(requestedPageSize, 10) || 50));
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const currentPage = Math.min(lastPage, Math.max(1, Number.parseInt(requestedPage, 10) || 1));
  const offset = (currentPage - 1) * perPage;
  const data = items.slice(offset, offset + perPage);

  return {
    current_page: currentPage,
    data,
    from: data.length ? offset + 1 : null,
    last_page: lastPage,
    per_page: perPage,
    to: data.length ? offset + data.length : null,
    total,
  };
}

function createServer(db, routerPort, apiToken = '') {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Middleware CORS & Token Auth
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  // Middleware de Token de API. Aunque el servidor escucha solo en loopback,
  // una página web externa podría intentar invocar servicios locales.
  const tokenMiddleware = (req, res, next) => {
    if (req.path === '/' || req.path === '/up' || req.path.startsWith('/dashboard') || !req.path.startsWith('/api/v1')) {
      return next();
    }
    if (!apiToken) return res.status(503).json({ success: false, message: 'Token local no configurado' });
    const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const expected = Buffer.from(apiToken);
    const candidate = Buffer.from(supplied);
    if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) {
      return res.status(401).json({ success: false, message: 'Token de API inválido' });
    }
    return next();
  };

  app.use(tokenMiddleware);

  app.get('/up', (req, res) => {
    res.json({
      status: 'ok',
      service: 'mcp-appcontrol-desktop',
      router_port: routerPort,
      timestamp: now(),
    });
  });

  // Servir Dashboard estático
  const dashboardPath = path.join(__dirname, '..', 'dashboard');
  app.use('/', express.static(dashboardPath));
  app.use('/dashboard', express.static(dashboardPath));

  app.post('/api/v1/devices/connect-tcp', async (req, res) => {
    const { address } = req.body || {};
    if (!address) return res.status(400).json({ success: false, message: 'Dirección TCP requerida' });
    const result = await adb.connectTcp(address);
    if (!result.success) return res.status(500).json(result);
    res.json(result);
  });
  app.get('/api/v1/devices', (req, res) => {
    let sql = `SELECT d.*, g.name as group_name FROM devices d LEFT JOIN device_groups g ON d.assigned_group_id = g.id WHERE 1=1`;
    const params = [];
    if (req.query.status) { sql += ` AND d.status = ?`; params.push(req.query.status); }
    if (req.query.search) { sql += ` AND (d.name LIKE ? OR d.serial_number LIKE ?)`; params.push(`%${req.query.search}%`, `%${req.query.search}%`); }
    sql += ` ORDER BY CASE d.status WHEN 'online' THEN 0 WHEN 'busy' THEN 1 WHEN 'error' THEN 2 ELSE 3 END, d.id ASC`;
    const list = db.all(sql, params);
    res.json({ success: true, data: paginate(list, req.query.page, req.query.per_page) });
  });

  app.get('/api/v1/devices/stats', (req, res) => {
    const total = db.get(`SELECT COUNT(*) as c FROM devices`).c;
    const online = db.get(`SELECT COUNT(*) as c FROM devices WHERE status = 'online'`).c;
    const busy = db.get(`SELECT COUNT(*) as c FROM devices WHERE status = 'busy'`).c;
    const offline = db.get(`SELECT COUNT(*) as c FROM devices WHERE status = 'offline'`).c;
    res.json({
      success: true,
      data: {
        total, online, busy, offline,
        health_percentage: total > 0 ? Number(((online / total) * 100).toFixed(2)) : 0
      }
    });
  });

  app.post('/api/v1/devices', (req, res) => {
    const { serial_number, name, model, android_version, status, transport, adb_serial } = req.body;
    if (!serial_number) return res.status(422).json({ success: false, message: 'serial_number es requerido' });

    let existing = db.get(`SELECT * FROM devices WHERE serial_number = ?`, [serial_number]);
    if (existing) {
      db.run(`UPDATE devices SET name=COALESCE(?,name), model=COALESCE(?,model), android_version=COALESCE(?,android_version), status=COALESCE(?,status), transport=COALESCE(?,transport), adb_serial=COALESCE(?,adb_serial), last_seen=?, updated_at=? WHERE id=?`,
        [name || null, model || null, android_version || null, status || null, transport || null, adb_serial || null, now(), now(), existing.id]);
    } else {
      db.run(`INSERT INTO devices(serial_number, name, model, android_version, status, transport, adb_serial, last_seen, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [serial_number, name || `Device ${serial_number}`, model || 'unknown', android_version || 'unknown', status || 'offline', transport || 'agent', adb_serial || null, now(), now(), now()]);
    }
    const dev = db.get(`SELECT * FROM devices WHERE serial_number = ?`, [serial_number]);
    pushDevicesChanged();
    res.status(201).json({ success: true, data: dev, message: 'Device registered successfully' });
  });

  app.post('/api/v1/devices/heartbeat', (req, res) => {
    const { serial_number, status } = req.body;
    const dev = db.get(`SELECT * FROM devices WHERE serial_number = ?`, [serial_number]);
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    const changed = (status || 'online') !== dev.status;
    db.run(`UPDATE devices SET status = ?, last_seen = ?, updated_at = ? WHERE id = ?`, [status || 'online', now(), now(), dev.id]);
    if (changed) pushDevicesChanged();
    res.json({ success: true });
  });

  app.post('/api/v1/devices/batch-command', async (req, res) => {
    const { device_ids, command, params } = req.body;
    if (!Array.isArray(device_ids) || !device_ids.length || !command) {
      return res.status(422).json({ success: false, message: 'device_ids y command son requeridos' });
    }
    if (device_ids.some(id => !Number.isInteger(Number(id)) || Number(id) <= 0)) {
      return res.status(422).json({ success: false, message: 'device_ids contiene identificadores inválidos' });
    }
    if (typeof command !== 'string' || command.length > 80 || !/^[A-Z][A-Z0-9_]*$/.test(command)) {
      return res.status(422).json({ success: false, message: 'command tiene un formato inválido' });
    }
    const step = { type: command, ...(params || {}) };
    const placeholders = device_ids.map(() => '?').join(',');
    const devices = db.all(`SELECT * FROM devices WHERE id IN (${placeholders})`, device_ids);
    const results = [];

    for (const d of devices) {
      const r = await logic.executeStep(d, step);
      db.run(`INSERT INTO execution_logs(device_serial, command_type, success, message, result_data, timestamp, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
        [d.serial_number, command, r.success ? 1 : 0, r.message, JSON.stringify(r.data || {}), now(), now(), now()]);
      results.push({ device_id: d.id, device: d.serial_number, success: !!r.success, message: r.message, data: r.data || null });
    }
    const ok = results.filter(x => x.success).length;
    const failed = results.length - ok;
    res.json({
      success: failed === 0,
      data: { total: results.length, ok, failed, results },
      message: failed === 0
        ? `Comando ${command} completado en ${ok} dispositivos`
        : `Comando ${command}: ${ok} correctos, ${failed} fallidos`,
    });
  });

  app.post('/api/v1/devices/:serial/command-result', (req, res) => {
    const { serial } = req.params;
    const { command_type, success, message, result_data, task_id } = req.body;
    db.run(`INSERT INTO execution_logs(task_id, device_serial, command_type, success, message, result_data, timestamp, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      [task_id || null, serial, command_type, success ? 1 : 0, message || null, JSON.stringify(result_data || {}), now(), now(), now()]);
    res.json({ success: true });
  });

  // Las capturas se guardan como FICHERO en disco (no en la BD): almacenar el
  // base64 en SQLite (sql.js en memoria) inflaba la BD y ralentizaba cada guardado.
  // En la tabla solo queda la ruta del fichero.
  const shotsDir = path.join(path.dirname(db.file && db.file !== ':memory:' ? db.file : __dirname), 'screenshots');
  app.post('/api/v1/devices/:serial/screenshot', (req, res) => {
    const { serial } = req.params;
    const { image_data } = req.body;
    let stored = image_data;
    try {
      if (image_data && image_data.length > 512) {
        fs.mkdirSync(shotsDir, { recursive: true });
        const safe = String(serial).replace(/[^\w.-]/g, '_');
        const file = path.join(shotsDir, `${safe}_${Date.now()}.png`);
        fs.writeFileSync(file, Buffer.from(image_data, 'base64'));
        stored = file; // guardamos la ruta, no el base64
      }
    } catch (_) { /* si falla el disco, cae al valor original */ }
    const r = db.run(`INSERT INTO screenshots(device_serial, image_data, timestamp, created_at, updated_at) VALUES (?,?,?,?,?)`,
      [serial, stored, now(), now(), now()]);
    res.status(201).json({ success: true, data: { id: r.lastInsertRowid, file: stored } });
  });

  app.post('/api/v1/devices/:serial/log', (req, res) => {
    const { serial } = req.params;
    const { message, success, task_id } = req.body;
    db.run(`INSERT INTO execution_logs(task_id, device_serial, command_type, success, message, timestamp, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      [task_id || null, serial, 'AGENT_LOG', success !== false ? 1 : 0, message, now(), now(), now()]);
    res.json({ success: true });
  });

  app.post('/api/v1/devices/:id/screen-frame', async (req, res) => {
    const dev = db.get(`SELECT * FROM devices WHERE id = ? OR serial_number = ?`, [req.params.id, req.params.id]);
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    if (dev.status !== 'online' && dev.status !== 'busy') {
      return res.status(409).json({ success: false, message: 'El dispositivo no está conectado.' });
    }
    // thumb=1 → miniatura ligera para el muro; sin thumb → alta calidad (visor enfocado)
    const thumb = req.query.thumb === '1' || req.query.thumb === 'true' || (req.body && req.body.thumb);
    let result = null;
    if (dev.adb_serial && adb.captureFrame) {
      result = await adb.captureFrame(dev, { thumb });
    } else {
      result = await logic.routerDispatch(dev.serial_number, 'CAPTURE_SCREEN', {});
      if (result.success && result.data && result.data.image) {
        result = { success: true, image: result.data.image, mime: 'image/png', source: 'agent' };
      } else {
        result = { success: false, message: result.message || 'No se pudo capturar pantalla' };
      }
    }
    if (!result.success) return res.status(502).json({ success: false, message: result.message });
    res.json({ success: true, data: { image: result.image, mime: result.mime || 'image/png', source: result.source || 'agent', captured_at: now() } });
  });

  app.get('/api/v1/devices/:id', (req, res) => {
    const dev = db.get(`SELECT d.*, g.name as group_name FROM devices d LEFT JOIN device_groups g ON d.assigned_group_id = g.id WHERE d.id = ? OR d.serial_number = ?`, [req.params.id, req.params.id]);
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    const logs = db.all(`SELECT * FROM execution_logs WHERE device_serial = ? ORDER BY timestamp DESC LIMIT 50`, [dev.serial_number]);
    res.json({ success: true, data: { device: dev, recent_logs: logs } });
  });

  app.put('/api/v1/devices/:id', (req, res) => {
    const dev = db.get(`SELECT * FROM devices WHERE id = ?`, [req.params.id]);
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    const { name, adb_serial, model, android_version, assigned_group_id } = req.body;
    db.run(`UPDATE devices SET name=COALESCE(?,name), adb_serial=COALESCE(?,adb_serial), model=COALESCE(?,model), android_version=COALESCE(?,android_version), assigned_group_id=COALESCE(?,assigned_group_id), updated_at=? WHERE id=?`,
      [name || null, adb_serial || null, model || null, android_version || null, assigned_group_id || null, now(), dev.id]);
    res.json({ success: true, data: db.get(`SELECT * FROM devices WHERE id=?`, [dev.id]), message: 'Device updated successfully' });
  });

  // ---- Proxy / IP de salida por dispositivo ----
  // Guarda la config de proxy y la aplica (o la limpia) en el teléfono por ADB.
  app.put('/api/v1/devices/:id/proxy', async (req, res) => {
    const dev = db.get(`SELECT * FROM devices WHERE id = ? OR serial_number = ?`, [req.params.id, req.params.id]);
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    const { host, port, user, pass, enabled } = req.body || {};
    try {
      if (!enabled) {
        const result = await proxies.clearAndRelease(dev, 'manual');
        return res.status(result.success ? 200 : 502).json(result);
      }
      if (!host || !port) {
        return res.status(422).json({ success: false, message: 'host y port son requeridos para activar el proxy' });
      }
      let proxy = proxies.list().find(item =>
        item.host === String(host).trim()
        && Number(item.port) === Number(port)
        && (item.username || '') === String(user || '').trim(),
      );
      if (!proxy) {
        proxy = proxies.create({
          name: `Manual · ${dev.serial_number}`,
          host,
          port,
          username: user,
          password: pass,
          max_devices: 1,
        });
      }
      const result = await proxies.assignAndApply(dev, {
        proxy_id: proxy.id,
        exclude_current: false,
        reason: 'manual-device',
      });
      return res.status(result.success ? 200 : 502).json(result);
    } catch (error) {
      return res.status(422).json({ success: false, message: error.message });
    }
  });

  // Consulta la IP externa/local real del dispositivo y la guarda.
  app.post('/api/v1/devices/:id/check-ip', async (req, res) => {
    const dev = db.get(`SELECT * FROM devices WHERE id = ? OR serial_number = ?`, [req.params.id, req.params.id]);
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    if (!dev.adb_serial || !adb.has || !adb.has(dev.adb_serial)) {
      return res.status(409).json({ success: false, message: 'El dispositivo no está conectado por USB/ADB' });
    }
    const r = await proxies.checkIp(dev);
    res.json({ success: r.success, data: { ...(r.data || {}), device_id: dev.id }, message: r.message });
  });

  // ---- Hora / zona horaria por dispositivo (estabilización + geo anti-detección) ----
  app.put('/api/v1/devices/:id/timezone', async (req, res) => {
    const dev = db.get(`SELECT * FROM devices WHERE id = ? OR serial_number = ?`, [req.params.id, req.params.id]);
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    const { timezone, auto } = req.body || {};
    // auto:true (o timezone vacío) → hora y zona automáticas; si no → zona fija.
    const tz = auto ? null : (timezone || '').trim() || null;
    db.run(`UPDATE devices SET timezone=?, time_synced_at=?, updated_at=? WHERE id=?`, [tz, now(), now(), dev.id]);
    let applied = null;
    if (dev.adb_serial && adb.has && adb.has(dev.adb_serial)) {
      applied = tz ? await adb.execute(dev.adb_serial, 'SET_TIMEZONE', { timezone: tz })
                   : await adb.execute(dev.adb_serial, 'SET_TIME_AUTO', { enabled: true });
    }
    res.json({ success: true, data: db.get(`SELECT * FROM devices WHERE id=?`, [dev.id]), applied, message: applied ? applied.message : 'Guardado (se aplicará al conectar)' });
  });

  app.get('/api/v1/devices/:id/time', async (req, res) => {
    const dev = db.get(`SELECT * FROM devices WHERE id = ? OR serial_number = ?`, [req.params.id, req.params.id]);
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    if (!dev.adb_serial || !adb.has || !adb.has(dev.adb_serial)) return res.status(409).json({ success: false, message: 'No conectado por ADB' });
    const r = await adb.execute(dev.adb_serial, 'GET_TIME', {});
    res.json({ success: r.success, data: r.data, message: r.message });
  });

  // ---- Pool de proxies: CRUD, distribución, rotación y comprobación ----
  app.get('/api/v1/proxies', (req, res) => {
    res.json({
      success: true,
      data: proxies.list({
        status: req.query.status,
        country: req.query.country,
        search: req.query.search,
      }),
    });
  });

  app.post('/api/v1/proxies', (req, res) => {
    try {
      res.status(201).json({ success: true, data: proxies.create(req.body || {}), message: 'Proxy agregado al pool' });
    } catch (error) {
      res.status(422).json({ success: false, message: error.message });
    }
  });

  app.post('/api/v1/proxies/import', (req, res) => {
    try {
      const rows = Array.isArray(req.body) ? req.body : req.body?.proxies;
      if (!Array.isArray(rows)) return res.status(422).json({ success: false, message: 'Se espera un array de proxies' });
      const result = proxies.importBulk(rows);
      return res.json({
        success: result.imported > 0 || result.rejected.length === 0,
        data: result,
        message: `${result.imported} proxies importados; ${result.rejected.length} rechazados`,
      });
    } catch (error) {
      return res.status(422).json({ success: false, message: error.message });
    }
  });

  app.put('/api/v1/proxies/:id', (req, res) => {
    try {
      const proxy = proxies.update(Number(req.params.id), req.body || {});
      if (!proxy) return res.status(404).json({ success: false, message: 'Proxy no encontrado' });
      return res.json({ success: true, data: proxy, message: 'Proxy actualizado' });
    } catch (error) {
      return res.status(422).json({ success: false, message: error.message });
    }
  });

  app.delete('/api/v1/proxies/:id', (req, res) => {
    try {
      if (!proxies.remove(Number(req.params.id))) {
        return res.status(404).json({ success: false, message: 'Proxy no encontrado' });
      }
      return res.json({ success: true, message: 'Proxy eliminado' });
    } catch (error) {
      return res.status(409).json({ success: false, message: error.message });
    }
  });

  app.get('/api/v1/devices/:id/proxy-assignment', (req, res) => {
    const dev = db.get('SELECT * FROM devices WHERE id=? OR serial_number=?', [req.params.id, req.params.id]);
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    return res.json({ success: true, data: proxies.activeAssignment(dev.id) });
  });

  app.post('/api/v1/devices/:id/proxy/assign', async (req, res) => {
    const dev = db.get('SELECT * FROM devices WHERE id=? OR serial_number=?', [req.params.id, req.params.id]);
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    try {
      const result = await proxies.assignAndApply(dev, req.body || {});
      return res.status(result.success ? 200 : 409).json(result);
    } catch (error) {
      return res.status(422).json({ success: false, message: error.message });
    }
  });

  app.post('/api/v1/devices/:id/proxy/rotate', async (req, res) => {
    const dev = db.get('SELECT * FROM devices WHERE id=? OR serial_number=?', [req.params.id, req.params.id]);
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    try {
      const result = await proxies.assignAndApply(dev, {
        ...(req.body || {}),
        exclude_current: true,
        reason: 'manual-rotation',
      });
      return res.status(result.success ? 200 : 409).json(result);
    } catch (error) {
      return res.status(422).json({ success: false, message: error.message });
    }
  });

  app.post('/api/v1/devices/:id/proxy/clear', async (req, res) => {
    const dev = db.get('SELECT * FROM devices WHERE id=? OR serial_number=?', [req.params.id, req.params.id]);
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    const result = await proxies.clearAndRelease(dev, 'manual');
    return res.status(result.success ? 200 : 502).json(result);
  });

  app.post('/api/v1/proxies/distribute', async (req, res) => {
    const body = req.body || {};
    const params = [];
    let sql = "SELECT * FROM devices WHERE status IN ('online','busy')";
    if (Array.isArray(body.device_ids)) {
      const ids = [...new Set(body.device_ids.map(Number).filter(Number.isInteger))];
      if (!ids.length) return res.status(422).json({ success: false, message: 'device_ids está vacío' });
      sql += ` AND id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    } else if (body.group_id != null) {
      sql += ' AND assigned_group_id=?';
      params.push(Number(body.group_id));
    }
    const devices = db.all(sql, params);
    if (!devices.length) return res.status(409).json({ success: false, message: 'No hay dispositivos online para distribuir' });
    try {
      const result = await proxies.distribute(devices, {
        strategy: body.strategy,
        country: body.country,
        tags: body.tags,
        reason: 'bulk-distribution',
      });
      return res.status(result.assigned > 0 ? 200 : 409).json({
        success: result.failed === 0,
        data: result,
        message: `${result.assigned} asignados; ${result.failed} fallidos`,
      });
    } catch (error) {
      return res.status(422).json({ success: false, message: error.message });
    }
  });

  // ---- Detección de baneo/captcha por dispositivo ----
  app.post('/api/v1/devices/:id/check-ban', async (req, res) => {
    const dev = db.get(`SELECT * FROM devices WHERE id = ? OR serial_number = ?`, [req.params.id, req.params.id]);
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    if (!dev.adb_serial || !adb.has || !adb.has(dev.adb_serial)) {
      return res.status(409).json({ success: false, message: 'El dispositivo no está conectado por USB/ADB' });
    }
    const hit = await monitor.checkDevice(dev, { source: 'manual' });
    res.json({ success: true, data: { flagged: !!hit, detection: hit }, message: hit ? `Detectado: ${hit.category}` : 'Sin señales de baneo/captcha' });
  });

  app.post('/api/v1/devices/:id/clear-flag', (req, res) => {
    const dev = db.get(`SELECT * FROM devices WHERE id = ? OR serial_number = ?`, [req.params.id, req.params.id]);
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    monitor.clearFlag(dev.id);
    db.run(`UPDATE devices SET status = CASE WHEN status='error' THEN 'online' ELSE status END WHERE id=?`, [dev.id]);
    pushDevicesChanged();
    res.json({ success: true, data: db.get(`SELECT * FROM devices WHERE id=?`, [dev.id]), message: 'Marca eliminada' });
  });

  app.delete('/api/v1/devices/:id', (req, res) => {
    const dev = db.get(`SELECT * FROM devices WHERE id = ?`, [req.params.id]);
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    if (dev.status === 'busy') return res.status(422).json({ success: false, message: 'Cannot delete device while it is busy' });
    db.run(`DELETE FROM devices WHERE id = ?`, [dev.id]);
    res.json({ success: true, message: 'Device deleted successfully' });
  });

  app.patch('/api/v1/devices/:id/status', (req, res) => {
    const dev = db.get(`SELECT * FROM devices WHERE id = ?`, [req.params.id]);
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    const { status, current_task_id } = req.body;
    db.run(`UPDATE devices SET status = COALESCE(?,status), current_task_id = ?, last_seen = ?, updated_at = ? WHERE id = ?`,
      [status || null, current_task_id || null, now(), now(), dev.id]);
    pushDevicesChanged();
    res.json({ success: true, data: db.get(`SELECT * FROM devices WHERE id = ?`, [dev.id]) });
  });

  // ==========================================
  // WORKFLOWS API (/api/v1/workflows)
  // ==========================================
  app.get('/api/v1/workflows', (req, res) => {
    let sql = `SELECT * FROM workflows WHERE 1=1`;
    const params = [];
    if (req.query.status) { sql += ` AND status = ?`; params.push(req.query.status); }
    if (req.query.search) { sql += ` AND name LIKE ?`; params.push(`%${req.query.search}%`); }
    sql += ` ORDER BY id DESC`;
    const list = db.all(sql, params).map(w => ({ ...w, steps: logic.safeJson(w.steps, []) }));
    res.json({ success: true, data: paginate(list, req.query.page, req.query.per_page) });
  });

  app.get('/api/v1/workflows/stats/:id', (req, res) => {
    const total = db.get(`SELECT COUNT(*) as c FROM tasks WHERE workflow_id = ?`, [req.params.id]).c;
    const completed = db.get(`SELECT COUNT(*) as c FROM tasks WHERE workflow_id = ? AND status = 'completed'`, [req.params.id]).c;
    const failed = db.get(`SELECT COUNT(*) as c FROM tasks WHERE workflow_id = ? AND status = 'failed'`, [req.params.id]).c;
    res.json({
      success: true,
      data: {
        total_tasks: total,
        completed_tasks: completed,
        failed_tasks: failed,
        success_rate: (total > 0 ? ((completed / total) * 100).toFixed(2) : 0) + '%'
      }
    });
  });

  app.get('/api/v1/workflows/:id', (req, res) => {
    const wf = db.get(`SELECT * FROM workflows WHERE id = ?`, [req.params.id]);
    if (!wf) return res.status(404).json({ success: false, message: 'Workflow not found' });
    wf.steps = logic.safeJson(wf.steps, []);
    const targets = db.all(`SELECT device_id FROM workflow_device_targets WHERE workflow_id = ?`, [wf.id]).map(t => t.device_id);
    wf.target_devices = targets.length ? db.all(`SELECT id, name, serial_number, status FROM devices WHERE id IN (${targets.join(',')})`) : [];
    res.json({ success: true, data: wf });
  });

  app.post('/api/v1/workflows', (req, res) => {
    const { name, description, steps, allowed_package, device_ids } = req.body;
    if (!name || !steps || !Array.isArray(steps)) return res.status(422).json({ success: false, message: 'Nombre y pasos válidos son requeridos' });

    const r = db.run(`INSERT INTO workflows(name, description, steps, allowed_package, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      [name, description || null, JSON.stringify(steps), allowed_package || null, 'draft', now(), now()]);
    const wfId = r.lastInsertRowid;
    if (Array.isArray(device_ids)) {
      for (const did of device_ids) {
        db.run(`INSERT OR IGNORE INTO workflow_device_targets(workflow_id, device_id, created_at, updated_at) VALUES (?,?,?,?)`, [wfId, did, now(), now()]);
      }
    }
    const wf = db.get(`SELECT * FROM workflows WHERE id = ?`, [wfId]);
    wf.steps = logic.safeJson(wf.steps, []);
    res.status(201).json({ success: true, data: wf, message: 'Workflow created successfully' });
  });

  app.put('/api/v1/workflows/:id', (req, res) => {
    const wf = db.get(`SELECT * FROM workflows WHERE id = ?`, [req.params.id]);
    if (!wf) return res.status(404).json({ success: false, message: 'Workflow not found' });
    const { name, description, steps, allowed_package, status, device_ids } = req.body;

    db.run(`UPDATE workflows SET name=COALESCE(?,name), description=COALESCE(?,description), steps=COALESCE(?,steps), allowed_package=COALESCE(?,allowed_package), status=COALESCE(?,status), updated_at=? WHERE id=?`,
      [name || null, description || null, steps ? JSON.stringify(steps) : null, allowed_package || null, status || null, now(), wf.id]);

    if (Array.isArray(device_ids)) {
      db.run(`DELETE FROM workflow_device_targets WHERE workflow_id = ?`, [wf.id]);
      for (const did of device_ids) {
        db.run(`INSERT OR IGNORE INTO workflow_device_targets(workflow_id, device_id, created_at, updated_at) VALUES (?,?,?,?)`, [wf.id, did, now(), now()]);
      }
    }
    const updated = db.get(`SELECT * FROM workflows WHERE id = ?`, [wf.id]);
    updated.steps = logic.safeJson(updated.steps, []);
    res.json({ success: true, data: updated, message: 'Workflow updated successfully' });
  });

  app.delete('/api/v1/workflows/:id', (req, res) => {
    const wf = db.get(`SELECT * FROM workflows WHERE id = ?`, [req.params.id]);
    if (!wf) return res.status(404).json({ success: false, message: 'Workflow not found' });
    const active = db.get(`SELECT COUNT(*) as c FROM tasks WHERE workflow_id = ? AND status IN ('scheduled','running')`, [wf.id]).c;
    if (active > 0) return res.status(422).json({ success: false, message: `Cannot delete workflow with ${active} active tasks` });
    db.run(`DELETE FROM workflows WHERE id = ?`, [wf.id]);
    db.run(`DELETE FROM workflow_device_targets WHERE workflow_id = ?`, [wf.id]);
    res.json({ success: true, message: 'Workflow deleted successfully' });
  });

  app.post('/api/v1/workflows/:id/execute', async (req, res) => {
    const wf = db.get(`SELECT * FROM workflows WHERE id = ?`, [req.params.id]);
    if (!wf) return res.status(404).json({ success: false, message: 'Workflow not found' });
    const { device_ids, group_id, params } = req.body;
    const r = await logic.dispatchWorkflow(wf, { groupId: group_id, deviceIds: device_ids, params });
    if (!r.task) return res.status(422).json({ success: false, message: r.message });
    res.status(201).json({ success: true, data: { task: r.task, devices_assigned: r.devices_assigned }, message: r.message });
  });

  app.post('/api/v1/workflows/:id/validate', (req, res) => {
    const wf = db.get(`SELECT * FROM workflows WHERE id = ?`, [req.params.id]);
    const steps = req.body.steps || (wf ? logic.safeJson(wf.steps, []) : []);
    res.json({ success: true, data: { valid: true, steps_count: steps.length } });
  });

  // ==========================================
  // TASKS API (/api/v1/tasks)
  // ==========================================
  app.get('/api/v1/tasks', (req, res) => {
    let sql = `SELECT t.*, w.name as workflow_name FROM tasks t LEFT JOIN workflows w ON t.workflow_id = w.id WHERE 1=1`;
    const params = [];
    if (req.query.status) { sql += ` AND t.status = ?`; params.push(req.query.status); }
    if (req.query.workflow_id) { sql += ` AND t.workflow_id = ?`; params.push(req.query.workflow_id); }
    if (req.query.search) { sql += ` AND t.external_id LIKE ?`; params.push(`%${req.query.search}%`); }
    sql += ` ORDER BY t.id DESC`;
    const list = db.all(sql, params);
    res.json({ success: true, data: paginate(list, req.query.page, req.query.per_page) });
  });

  app.get('/api/v1/tasks/stats', (req, res) => {
    const total = db.get(`SELECT COUNT(*) as c FROM tasks`).c;
    const completed = db.get(`SELECT COUNT(*) as c FROM tasks WHERE status = 'completed'`).c;
    const failed = db.get(`SELECT COUNT(*) as c FROM tasks WHERE status = 'failed'`).c;
    const running = db.get(`SELECT COUNT(*) as c FROM tasks WHERE status = 'running'`).c;
    const scheduled = db.get(`SELECT COUNT(*) as c FROM tasks WHERE status = 'scheduled'`).c;
    res.json({
      success: true,
      data: {
        total_tasks: total, completed_tasks: completed, failed_tasks: failed,
        running_tasks: running, scheduled_tasks: scheduled,
        success_rate: (total > 0 ? ((completed / total) * 100).toFixed(2) : 0) + '%'
      }
    });
  });

  app.get('/api/v1/tasks/daily-report', (req, res) => {
    const today = now().slice(0, 10);
    const tasks = db.all(`SELECT status, COUNT(*) as c FROM tasks WHERE created_at LIKE ? GROUP BY status`, [`${today}%`]);
    const counts = {}; tasks.forEach(t => counts[t.status] = t.c);
    res.json({
      success: true,
      data: {
        date: today,
        tasks_created: (counts.completed || 0) + (counts.failed || 0) + (counts.running || 0),
        tasks_completed: counts.completed || 0,
        tasks_failed: counts.failed || 0
      }
    });
  });

  app.get('/api/v1/tasks/:id', (req, res) => {
    const task = db.get(`SELECT t.*, w.name as workflow_name FROM tasks t LEFT JOIN workflows w ON t.workflow_id = w.id WHERE t.id = ? OR t.external_id = ?`, [req.params.id, req.params.id]);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    const logs = db.all(`SELECT * FROM execution_logs WHERE task_id = ? ORDER BY timestamp DESC`, [task.id]);
    res.json({ success: true, data: { task, execution_logs: logs } });
  });

  app.post('/api/v1/tasks/:id/cancel', (req, res) => {
    const task = db.get(`SELECT * FROM tasks WHERE id = ?`, [req.params.id]);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    if (task.status !== 'scheduled' && task.status !== 'running') {
      return res.status(422).json({ success: false, message: `Cannot cancel task with status: ${task.status}` });
    }
    db.run(`UPDATE tasks SET status = 'cancelled', completed_at = ? WHERE id = ?`, [now(), task.id]);
    db.run(`UPDATE devices SET status = 'online', current_task_id = NULL WHERE current_task_id = ?`, [task.id]);
    res.json({ success: true, data: db.get(`SELECT * FROM tasks WHERE id = ?`, [task.id]), message: 'Task cancelled successfully' });
  });

  app.post('/api/v1/tasks/:id/retry', async (req, res) => {
    const task = db.get(`SELECT * FROM tasks WHERE id = ?`, [req.params.id]);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    const wf = db.get(`SELECT * FROM workflows WHERE id = ?`, [task.workflow_id]);
    if (!wf) return res.status(404).json({ success: false, message: 'Workflow for task not found' });
    const r = await logic.dispatchWorkflow(wf, { params: logic.safeJson(task.params, {}) });
    res.json({ success: true, data: r.task, message: 'Task retry initiated' });
  });

  // ==========================================
  // GROUPS API (/api/v1/groups)
  // ==========================================
  app.get('/api/v1/groups', (req, res) => {
    let sql = `SELECT g.*, COUNT(d.id) as device_count FROM device_groups g LEFT JOIN devices d ON d.assigned_group_id = g.id WHERE 1=1`;
    const params = [];
    if (req.query.search) { sql += ` AND g.name LIKE ?`; params.push(`%${req.query.search}%`); }
    sql += ` GROUP BY g.id ORDER BY g.id ASC`;
    const list = db.all(sql, params);
    res.json({ success: true, data: paginate(list, req.query.page, req.query.per_page) });
  });

  app.get('/api/v1/groups/:id', (req, res) => {
    const group = db.get(`SELECT * FROM device_groups WHERE id = ?`, [req.params.id]);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    const devices = db.all(`SELECT * FROM devices WHERE assigned_group_id = ?`, [group.id]);
    const online = devices.filter(d => d.status === 'online').length;
    const busy = devices.filter(d => d.status === 'busy').length;
    res.json({
      success: true,
      data: { group: { ...group, devices }, statistics: { total_devices: devices.length, online_devices: online, busy_devices: busy } }
    });
  });

  app.post('/api/v1/groups', (req, res) => {
    const { name, description, max_devices } = req.body;
    if (!name) return res.status(422).json({ success: false, message: 'El nombre del grupo es requerido' });
    const exists = db.get(`SELECT * FROM device_groups WHERE name = ?`, [name]);
    if (exists) return res.status(422).json({ success: false, message: 'Group with this name already exists' });
    const r = db.run(`INSERT INTO device_groups(name, description, max_devices, created_at, updated_at) VALUES (?,?,?,?,?)`,
      [name, description || null, max_devices || null, now(), now()]);
    res.status(201).json({ success: true, data: db.get(`SELECT * FROM device_groups WHERE id = ?`, [r.lastInsertRowid]), message: 'Device group created successfully' });
  });

  app.put('/api/v1/groups/:id', (req, res) => {
    const group = db.get(`SELECT * FROM device_groups WHERE id = ?`, [req.params.id]);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    const { name, description, max_devices } = req.body;
    db.run(`UPDATE device_groups SET name=COALESCE(?,name), description=COALESCE(?,description), max_devices=COALESCE(?,max_devices), updated_at=? WHERE id=?`,
      [name || null, description || null, max_devices || null, now(), group.id]);
    res.json({ success: true, data: db.get(`SELECT * FROM device_groups WHERE id = ?`, [group.id]), message: 'Device group updated successfully' });
  });

  app.delete('/api/v1/groups/:id', (req, res) => {
    const group = db.get(`SELECT * FROM device_groups WHERE id = ?`, [req.params.id]);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    const count = db.get(`SELECT COUNT(*) as c FROM devices WHERE assigned_group_id = ?`, [group.id]).c;
    if (count > 0) return res.status(422).json({ success: false, message: `Cannot delete group with ${count} assigned devices` });
    db.run(`DELETE FROM device_groups WHERE id = ?`, [group.id]);
    res.json({ success: true, message: 'Device group deleted successfully' });
  });

  app.post('/api/v1/groups/:id/pause', (req, res) => {
    const group = db.get(`SELECT * FROM device_groups WHERE id = ?`, [req.params.id]);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    db.run(`UPDATE device_groups SET paused_at = ? WHERE id = ?`, [now(), group.id]);
    res.json({ success: true, data: db.get(`SELECT * FROM device_groups WHERE id = ?`, [group.id]), message: 'Group paused' });
  });

  app.post('/api/v1/groups/:id/resume', (req, res) => {
    const group = db.get(`SELECT * FROM device_groups WHERE id = ?`, [req.params.id]);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    db.run(`UPDATE device_groups SET paused_at = NULL WHERE id = ?`, [group.id]);
    res.json({ success: true, data: db.get(`SELECT * FROM device_groups WHERE id = ?`, [group.id]), message: 'Group resumed' });
  });

  app.post('/api/v1/groups/:id/assign-devices', (req, res) => {
    const { device_ids } = req.body;
    if (!Array.isArray(device_ids) || !device_ids.length) return res.status(422).json({ success: false, message: 'device_ids requeridos' });
    const placeholders = device_ids.map(() => '?').join(',');
    db.run(`UPDATE devices SET assigned_group_id = ?, updated_at = ? WHERE id IN (${placeholders})`, [req.params.id, now(), ...device_ids]);
    res.json({ success: true, message: `Assigned ${device_ids.length} devices to group` });
  });

  app.post('/api/v1/groups/:id/remove-devices', (req, res) => {
    const { device_ids } = req.body;
    if (!Array.isArray(device_ids) || !device_ids.length) return res.status(422).json({ success: false, message: 'device_ids requeridos' });
    const placeholders = device_ids.map(() => '?').join(',');
    db.run(`UPDATE devices SET assigned_group_id = NULL, updated_at = ? WHERE id IN (${placeholders})`, [now(), ...device_ids]);
    res.json({ success: true, message: `Removed ${device_ids.length} devices from group` });
  });

  // ==========================================
  // SCHEDULES API (/api/v1/schedules)
  // ==========================================
  app.get('/api/v1/schedules', (req, res) => {
    const list = db.all(`SELECT s.*, w.name as workflow_name, g.name as group_name FROM schedules s LEFT JOIN workflows w ON s.workflow_id = w.id LEFT JOIN device_groups g ON s.group_id = g.id ORDER BY s.is_active DESC, s.name ASC`);
    list.forEach(s => {
      s.times = logic.safeJson(s.times, []);
      s.days_of_week = logic.safeJson(s.days_of_week, []);
      s.is_active = !!s.is_active;
    });
    res.json({ success: true, data: paginate(list, req.query.page, req.query.per_page || 50) });
  });

  app.get('/api/v1/schedules/:id', (req, res) => {
    const s = db.get(`SELECT s.*, w.name as workflow_name, g.name as group_name FROM schedules s LEFT JOIN workflows w ON s.workflow_id = w.id LEFT JOIN device_groups g ON s.group_id = g.id WHERE s.id = ?`, [req.params.id]);
    if (!s) return res.status(404).json({ success: false, message: 'Schedule not found' });
    s.times = logic.safeJson(s.times, []);
    s.days_of_week = logic.safeJson(s.days_of_week, []);
    s.is_active = !!s.is_active;
    res.json({ success: true, data: s });
  });

  app.post('/api/v1/schedules', (req, res) => {
    const { name, workflow_id, group_id, mode, times, window_start, window_end, loop_gap_seconds, days_of_week, is_active } = req.body;
    if (!name || !workflow_id || !mode) return res.status(422).json({ success: false, message: 'Name, workflow_id y mode son requeridos' });

    const r = db.run(`INSERT INTO schedules(name, workflow_id, group_id, mode, times, window_start, window_end, loop_gap_seconds, days_of_week, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [name, workflow_id, group_id || null, mode, times ? JSON.stringify(times) : null, window_start || null, window_end || null, loop_gap_seconds || 0, days_of_week ? JSON.stringify(days_of_week) : null, is_active !== false ? 1 : 0, now(), now()]);
    const created = db.get(`SELECT * FROM schedules WHERE id = ?`, [r.lastInsertRowid]);
    res.status(201).json({ success: true, data: created, message: 'Schedule creado' });
  });

  app.put('/api/v1/schedules/:id', (req, res) => {
    const s = db.get(`SELECT * FROM schedules WHERE id = ?`, [req.params.id]);
    if (!s) return res.status(404).json({ success: false, message: 'Schedule not found' });
    const { name, workflow_id, group_id, mode, times, window_start, window_end, loop_gap_seconds, days_of_week, is_active } = req.body;

    db.run(`UPDATE schedules SET name=COALESCE(?,name), workflow_id=COALESCE(?,workflow_id), group_id=COALESCE(?,group_id), mode=COALESCE(?,mode), times=COALESCE(?,times), window_start=COALESCE(?,window_start), window_end=COALESCE(?,window_end), loop_gap_seconds=COALESCE(?,loop_gap_seconds), days_of_week=COALESCE(?,days_of_week), is_active=COALESCE(?,is_active), updated_at=? WHERE id=?`,
      [name || null, workflow_id || null, group_id || null, mode || null, times ? JSON.stringify(times) : null, window_start || null, window_end || null, loop_gap_seconds !== undefined ? loop_gap_seconds : null, days_of_week ? JSON.stringify(days_of_week) : null, is_active !== undefined ? (is_active ? 1 : 0) : null, now(), s.id]);
    res.json({ success: true, data: db.get(`SELECT * FROM schedules WHERE id = ?`, [s.id]), message: 'Schedule actualizado' });
  });

  app.delete('/api/v1/schedules/:id', (req, res) => {
    db.run(`DELETE FROM schedules WHERE id = ?`, [req.params.id]);
    res.json({ success: true, message: 'Schedule eliminado' });
  });

  app.post('/api/v1/schedules/:id/pause', (req, res) => {
    db.run(`UPDATE schedules SET is_active = 0 WHERE id = ?`, [req.params.id]);
    res.json({ success: true, data: db.get(`SELECT * FROM schedules WHERE id = ?`, [req.params.id]), message: 'Schedule pausado' });
  });

  app.post('/api/v1/schedules/:id/resume', (req, res) => {
    db.run(`UPDATE schedules SET is_active = 1 WHERE id = ?`, [req.params.id]);
    res.json({ success: true, data: db.get(`SELECT * FROM schedules WHERE id = ?`, [req.params.id]), message: 'Schedule reanudado' });
  });

  app.post('/api/v1/schedules/:id/run-now', async (req, res) => {
    const s = db.get(`SELECT * FROM schedules WHERE id = ?`, [req.params.id]);
    if (!s) return res.status(404).json({ success: false, message: 'Schedule not found' });
    const wf = db.get(`SELECT * FROM workflows WHERE id = ?`, [s.workflow_id]);
    if (!wf) return res.status(422).json({ success: false, message: 'La rutina no existe' });

    const r = await logic.dispatchWorkflow(wf, { groupId: s.group_id, params: { schedule_id: s.id, schedule_name: s.name, manual: true } });
    if (!r.task) return res.status(422).json({ success: false, message: r.message });
    db.run(`UPDATE schedules SET last_run_at = ? WHERE id = ?`, [now(), s.id]);
    res.status(201).json({ success: true, data: { task: r.task, devices_assigned: r.devices_assigned }, message: r.message });
  });

  // ==========================================
  // REPORTS & DASHBOARD API
  // ==========================================
  app.get('/api/v1/reports/execution-summary', (req, res) => {
    const days = parseInt(req.query.period) || 7;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();

    const tasks = db.all(`SELECT status, COUNT(*) as count FROM tasks WHERE created_at >= ? GROUP BY status`, [cutoff]);
    const taskStats = { total_tasks: 0, completed_tasks: 0, failed_tasks: 0, running_tasks: 0, scheduled_tasks: 0 };
    tasks.forEach(t => {
      taskStats.total_tasks += t.count;
      if (t.status === 'completed') taskStats.completed_tasks = t.count;
      if (t.status === 'failed') taskStats.failed_tasks = t.count;
      if (t.status === 'running') taskStats.running_tasks = t.count;
      if (t.status === 'scheduled') taskStats.scheduled_tasks = t.count;
    });

    const deviceStats = db.all(`SELECT device_serial, COUNT(*) as total_commands, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_commands FROM execution_logs WHERE timestamp >= ? GROUP BY device_serial`, [cutoff]);
    const workflowPerf = db.all(`SELECT w.name, COUNT(*) as total_tasks, SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks FROM tasks t JOIN workflows w ON t.workflow_id = w.id WHERE t.created_at >= ? GROUP BY w.id, w.name`, [cutoff]);

    res.json({ success: true, data: { period_days: days, task_statistics: taskStats, device_statistics: deviceStats, workflow_performance: workflowPerf } });
  });

  app.get('/api/v1/reports/device-failures', (req, res) => {
    const days = parseInt(req.query.period) || 30;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const failures = db.all(`SELECT device_serial, command_type, COUNT(*) as failure_count, MAX(timestamp) as last_failure FROM execution_logs WHERE timestamp >= ? AND success = 0 GROUP BY device_serial, command_type ORDER BY failure_count DESC`, [cutoff]);
    const errors = db.all(`SELECT message, COUNT(*) as count FROM execution_logs WHERE timestamp >= ? AND success = 0 GROUP BY message ORDER BY count DESC LIMIT 10`, [cutoff]);
    res.json({ success: true, data: { period_days: days, failures_by_device: failures, common_errors: errors } });
  });

  app.get('/api/v1/reports/daily-activity', (req, res) => {
    const days = parseInt(req.query.days) || 30;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const dailyTasks = db.all(`SELECT DATE(created_at) as date, COUNT(*) as total_tasks, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_tasks FROM tasks WHERE created_at >= ? GROUP BY date ORDER BY date ASC`, [cutoff]);
    const dailyDev = db.all(`SELECT DATE(timestamp) as date, COUNT(*) as total_commands, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_commands FROM execution_logs WHERE timestamp >= ? GROUP BY date ORDER BY date ASC`, [cutoff]);
    res.json({ success: true, data: { period_days: days, daily_tasks: dailyTasks, daily_device_activity: dailyDev } });
  });

  app.get('/api/v1/dashboard/stats', (req, res) => {
    const devCounts = db.all(`SELECT status, COUNT(*) as count FROM devices GROUP BY status`);
    const devObj = { total: 0, online: 0, busy: 0, offline: 0, error: 0 };
    devCounts.forEach(d => { devObj[d.status] = d.count; devObj.total += d.count; });

    const taskCounts = db.all(`SELECT status, COUNT(*) as count FROM tasks GROUP BY status`);
    const taskObj = { total: 0, running: 0, scheduled: 0, completed: 0, failed: 0, success_rate: 0 };
    taskCounts.forEach(t => { taskObj[t.status] = t.count; taskObj.total += t.count; });
    if (taskObj.total > 0) taskObj.success_rate = Number(((taskObj.completed / taskObj.total) * 100).toFixed(2));

    const totalWf = db.get(`SELECT COUNT(*) as c FROM workflows`).c;
    const activeWf = db.get(`SELECT COUNT(*) as c FROM workflows WHERE status = 'active'`).c;
    const totalGr = db.get(`SELECT COUNT(*) as c FROM device_groups`).c;

    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const recentActivity = db.get(`SELECT COUNT(*) as c FROM execution_logs WHERE timestamp >= ?`, [oneHourAgo]).c;

    res.json({
      success: true,
      data: {
        devices: devObj,
        tasks: taskObj,
        workflows: { total: totalWf, active: activeWf },
        groups: { total: totalGr },
        recent_activity: recentActivity
      }
    });
  });

  app.get('/api/v1/dashboard/realtime', (req, res) => {
    const devCounts = db.all(`SELECT status, COUNT(*) as count FROM devices GROUP BY status`);
    const devObj = { online: 0, busy: 0, offline: 0, error: 0 };
    devCounts.forEach(d => { devObj[d.status] = d.count; });

    const runningTasks = db.get(`SELECT COUNT(*) as c FROM tasks WHERE status = 'running'`).c;
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const recentActivity = db.all(`SELECT command_type, COUNT(*) as count FROM execution_logs WHERE timestamp >= ? GROUP BY command_type`, [oneHourAgo]);

    res.json({
      success: true,
      data: {
        device_status_counts: devObj,
        running_tasks_count: runningTasks,
        recent_activity: recentActivity
      }
    });
  });

  // ==========================================
  // NOTIFICACIONES / ALERTAS
  // ==========================================
  app.get('/api/v1/notifications', (req, res) => {
    const list = db.all(`SELECT * FROM notifications ORDER BY id DESC LIMIT 100`);
    list.forEach(n => { n.data = logic.safeJson(n.data, {}); n.read = !!n.read; });
    const unread = db.get(`SELECT COUNT(*) as c FROM notifications WHERE read = 0`).c;
    res.json({ success: true, data: { notifications: list, unread } });
  });

  app.post('/api/v1/notifications/:id/read', (req, res) => {
    db.run(`UPDATE notifications SET read = 1, updated_at = ? WHERE id = ?`, [now(), req.params.id]);
    res.json({ success: true });
  });

  app.post('/api/v1/notifications/read-all', (req, res) => {
    db.run(`UPDATE notifications SET read = 1, updated_at = ? WHERE read = 0`, [now()]);
    res.json({ success: true });
  });

  app.delete('/api/v1/notifications', (req, res) => {
    db.run(`DELETE FROM notifications`);
    res.json({ success: true, message: 'Notificaciones borradas' });
  });

  // ==========================================
  // CUENTAS (almacén cifrado + asignación + rotación)
  // ==========================================
  app.get('/api/v1/accounts', (req, res) => {
    const { platform, status, device_id } = req.query;
    res.json({ success: true, data: accounts.list({ platform, status, device_id: device_id != null ? Number(device_id) : undefined }) });
  });
  app.post('/api/v1/accounts', (req, res) => {
    if (!req.body || (!req.body.username && !req.body.email)) return res.status(422).json({ success: false, message: 'username o email requerido' });
    res.status(201).json({ success: true, data: accounts.create(req.body), message: 'Cuenta creada' });
  });
  app.post('/api/v1/accounts/import', (req, res) => {
    const rows = Array.isArray(req.body) ? req.body : (req.body && req.body.accounts);
    if (!Array.isArray(rows)) return res.status(422).json({ success: false, message: 'Se espera un array de cuentas' });
    const n = accounts.importBulk(rows);
    res.json({ success: true, data: { imported: n }, message: `${n} cuentas importadas` });
  });
  app.put('/api/v1/accounts/:id', (req, res) => {
    const a = accounts.update(Number(req.params.id), req.body || {});
    if (!a) return res.status(404).json({ success: false, message: 'Cuenta no encontrada' });
    res.json({ success: true, data: a, message: 'Cuenta actualizada' });
  });
  app.delete('/api/v1/accounts/:id', (req, res) => { accounts.remove(Number(req.params.id)); res.json({ success: true, message: 'Cuenta eliminada' }); });
  app.post('/api/v1/accounts/:id/assign', (req, res) => {
    const { device_id } = req.body || {};
    if (device_id == null) return res.status(422).json({ success: false, message: 'device_id requerido' });
    const a = accounts.assign(Number(req.params.id), Number(device_id));
    if (!a) return res.status(404).json({ success: false, message: 'Cuenta no encontrada' });
    res.json({ success: true, data: a, message: 'Cuenta asignada' });
  });
  app.post('/api/v1/accounts/:id/unassign', (req, res) => { res.json({ success: true, data: accounts.unassign(Number(req.params.id)) }); });
  app.post('/api/v1/accounts/:id/status', (req, res) => {
    const { status } = req.body || {};
    if (!status) return res.status(422).json({ success: false, message: 'status requerido' });
    res.json({ success: true, data: accounts.setStatus(Number(req.params.id), status) });
  });
  // TOTP actual (para pegar el 2FA manualmente si hace falta)
  app.get('/api/v1/accounts/:id/totp', (req, res) => {
    const a = db.get('SELECT * FROM accounts WHERE id=?', [req.params.id]);
    if (!a) return res.status(404).json({ success: false, message: 'Cuenta no encontrada' });
    const code = a.totp_enc ? accounts.totp(accounts._dec(a.totp_enc)) : '';
    res.json({ success: true, data: { code } });
  });
  app.post('/api/v1/devices/:id/rotate-account', (req, res) => {
    const dev = db.get('SELECT * FROM devices WHERE id = ? OR serial_number = ?', [req.params.id, req.params.id]);
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    const r = accounts.rotate(dev.id, (req.body || {}).platform);
    res.json({ success: r.rotated, data: r, message: r.rotated ? `Cuenta activa: ${r.next.username}` : 'Sin cuentas disponibles' });
  });

  app.get('/api/v1/alerts/config', (req, res) => {
    res.json({ success: true, data: alerts.getConfig() });
  });

  app.put('/api/v1/alerts/config', (req, res) => {
    res.json({ success: true, data: alerts.setConfig(req.body || {}), message: 'Configuración de alertas guardada' });
  });

  // Prueba de canales de alerta (envía una notificación de ejemplo).
  app.post('/api/v1/alerts/test', async (req, res) => {
    await alerts.notify({ type: 'test', severity: 'info', message: 'Alerta de prueba de MCP Control Bsolutions V1' });
    res.json({ success: true, message: 'Alerta de prueba enviada' });
  });

  // Ajustes generales (humanización + salud de hardware)
  app.get('/api/v1/settings', (req, res) => res.json({ success: true, data: settings.get() }));
  app.put('/api/v1/settings', (req, res) => res.json({ success: true, data: settings.set(req.body || {}), message: 'Ajustes guardados' }));

  // Integración portable con Hermes. La mutación de config.yaml solo ocurre
  // después de una acción explícita del usuario en el panel.
  app.get('/api/v1/hermes/status', async (req, res) => {
    const data = await hermes.status();
    res.json({ success: true, data });
  });
  app.post('/api/v1/hermes/configure', async (req, res) => {
    try {
      const data = await hermes.configure();
      res.json({ success: true, data, message: data.message });
    } catch (error) {
      res.status(422).json({ success: false, message: error.message });
    }
  });
  app.post('/api/v1/hermes/test', async (req, res) => {
    try {
      const data = await hermes.testConnection();
      res.status(data.success ? 200 : 502).json({ success: data.success, data, message: data.message });
    } catch (error) {
      res.status(422).json({ success: false, message: error.message });
    }
  });
  app.delete('/api/v1/hermes/connection', async (req, res) => {
    try {
      const data = await hermes.disconnect();
      res.json({ success: true, data, message: data.message });
    } catch (error) {
      res.status(422).json({ success: false, message: error.message });
    }
  });

  // Lectura de salud de hardware bajo demanda
  app.post('/api/v1/devices/:id/health', async (req, res) => {
    const dev = db.get('SELECT * FROM devices WHERE id = ? OR serial_number = ?', [req.params.id, req.params.id]);
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    if (!dev.adb_serial || !adb.has || !adb.has(dev.adb_serial)) return res.status(409).json({ success: false, message: 'No conectado por ADB' });
    const r = await adb.execute(dev.adb_serial, 'DEVICE_HEALTH', {});
    if (r.success && r.data) {
      const h = r.data;
      db.run('UPDATE devices SET battery_level=?, temperature_c=?, storage_free_mb=?, charging=?, health_at=?, updated_at=? WHERE id=?',
        [h.battery ?? null, h.temperature_c ?? null, h.storage_free_mb ?? null, h.charging ?? null, now(), now(), dev.id]);
    }
    res.json({ success: r.success, data: r.data, message: r.message });
  });

  // ==========================================
  // VIEWS FARM (Fase 1) — Campañas de views multi-plataforma
  // ==========================================
  app.get('/api/v1/views/dashboard', (req, res) => {
    try {
      const data = views.getViewsDashboard();
      res.json({ success: true, data });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Listar campañas de views
  app.get('/api/v1/views/campaigns', (req, res) => {
    try {
      let sql = `SELECT * FROM view_campaigns WHERE 1=1`;
      const params = [];
      if (req.query.platform) { sql += ` AND platform = ?`; params.push(req.query.platform); }
      if (req.query.status) { sql += ` AND status = ?`; params.push(req.query.status); }
      sql += ` ORDER BY created_at DESC`;
      const list = db.all(sql, params);
      res.json({ success: true, data: paginate(list, req.query.page, req.query.per_page) });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Crear campaña de views
  app.post('/api/v1/views/campaigns', async (req, res) => {
    try {
      const { name, platform, device_ids, group_id, config, mode } = req.body;
      if (!name || !platform) return res.status(422).json({ success: false, message: 'Nombre y plataforma son requeridos' });
      const result = views.createCampaign({ name, platform, device_ids, group_id, config, mode: mode || 'one_shot' });
      // Si es one_shot, ejecutar inmediatamente (async no bloquea)
      if (mode === 'one_shot') {
        views.runCampaignAsync(result.campaign.id);
      } else {
        // Para continuous/burst, se dispara por el scheduler
        db.run(`UPDATE view_campaigns SET mode = ?, updated_at = ? WHERE id = ?`, [mode || 'continuous', now(), result.campaign.id]);
      }
      res.status(201).json({ success: true, data: result, message: `Campaña "${name}" creada` });
    } catch (e) {
      res.status(422).json({ success: false, message: e.message });
    }
  });

  // Ejecutar campaña manualmente
  app.post('/api/v1/views/campaigns/:id/run', async (req, res) => {
    try {
      const result = await views.runCampaign(req.params.id);
      res.json({ success: true, data: result, message: 'Campaña ejecutada' });
    } catch (e) {
      res.status(422).json({ success: false, message: e.message });
    }
  });

  // Métricas de una campaña
  app.get('/api/v1/views/campaigns/:id/stats', (req, res) => {
    try {
      const stats = views.getCampaignStats(req.params.id);
      if (!stats) return res.status(404).json({ success: false, message: 'Campaña no encontrada' });
      res.json({ success: true, data: stats });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Listar sesiones de views
  app.get('/api/v1/views/sessions', (req, res) => {
    try {
      let sql = `SELECT vs.*, d.name as device_name FROM view_sessions vs LEFT JOIN devices d ON vs.device_serial = d.serial_number WHERE 1=1`;
      const params = [];
      if (req.query.campaign_id) { sql += ` AND vs.campaign_id = ?`; params.push(req.query.campaign_id); }
      if (req.query.platform) { sql += ` AND vs.platform = ?`; params.push(req.query.platform); }
      if (req.query.status) { sql += ` AND vs.status = ?`; params.push(req.query.status); }
      sql += ` ORDER BY vs.created_at DESC`;
      const list = db.all(sql, params);
      res.json({ success: true, data: paginate(list, req.query.page, req.query.per_page) });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Generar pasos de patrón para preview (sin ejecutar)
  app.post('/api/v1/views/pattern-preview', (req, res) => {
    try {
      const { platform, config } = req.body || {};
      if (!platform) return res.status(422).json({ success: false, message: 'Plataforma requerida' });
      const pattern = views.generateViewSteps(platform, config);
      res.json({ success: true, data: pattern });
    } catch (e) {
      res.status(422).json({ success: false, message: e.message });
    }
  });

  // Listar plataformas soportadas
  app.get('/api/v1/views/platforms', (req, res) => {
    res.json({ success: true, data: views.PATTERN_MAP.map(p => ({ name: p, label: p.charAt(0).toUpperCase() + p.slice(1) })) });
  });

  return app;
}

module.exports = { createServer };
