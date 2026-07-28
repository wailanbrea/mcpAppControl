'use strict';

const { now } = require('./db');

const VALID_PROTOCOLS = new Set(['http']);
const VALID_STATUSES = new Set(['active', 'disabled', 'error']);
const VALID_STRATEGIES = new Set(['round_robin', 'random']);

let DB = null;
let encrypt = null;
let decrypt = null;
let dispatch = null;

function init(db, dependencies = {}) {
  DB = db;
  encrypt = dependencies.encrypt;
  decrypt = dependencies.decrypt;
  dispatch = dependencies.dispatch;
  if (typeof encrypt !== 'function' || typeof decrypt !== 'function') {
    throw new Error('El almacén de proxies requiere cifrado inicializado');
  }
}

function requireInit() {
  if (!DB) throw new Error('El almacén de proxies no está inicializado');
}

function cleanText(value, maxLength = 255) {
  if (value == null) return null;
  const result = String(value).trim();
  return result ? result.slice(0, maxLength) : null;
}

function validateHost(value) {
  const host = cleanText(value, 253);
  if (!host || /[\s/?#@]/.test(host)) throw new Error('Host de proxy inválido');
  return host;
}

function validatePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('El puerto debe estar entre 1 y 65535');
  }
  return port;
}

function validateMaxDevices(value) {
  const max = value == null ? 1 : Number(value);
  if (!Number.isInteger(max) || max < 1 || max > 1000) {
    throw new Error('max_devices debe estar entre 1 y 1000');
  }
  return max;
}

function normalizeTags(value) {
  if (value == null || value === '') return [];
  const source = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(source.map(tag => cleanText(tag, 64)).filter(Boolean))].slice(0, 30);
}

function parseTags(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function publicView(proxy) {
  if (!proxy) return null;
  return {
    id: proxy.id,
    name: proxy.name,
    host: proxy.host,
    port: proxy.port,
    protocol: proxy.protocol,
    username: proxy.username,
    has_password: !!proxy.password_enc,
    requires_auth: !!(proxy.username || proxy.password_enc),
    country: proxy.country,
    tags: parseTags(proxy.tags),
    status: proxy.status,
    max_devices: proxy.max_devices,
    assigned_devices: Number(proxy.assigned_devices || 0),
    failure_count: Number(proxy.failure_count || 0),
    last_used_at: proxy.last_used_at,
    last_checked_at: proxy.last_checked_at,
    last_error: proxy.last_error,
    created_at: proxy.created_at,
    updated_at: proxy.updated_at,
  };
}

function queryWithCounts(where = '', params = []) {
  return DB.all(`
    SELECT p.*,
      (SELECT COUNT(*) FROM proxy_assignments pa WHERE pa.proxy_id=p.id AND pa.active=1) AS assigned_devices
    FROM proxies p
    ${where}
  `, params);
}

function list(filters = {}) {
  requireInit();
  const clauses = [];
  const params = [];
  if (filters.status) {
    clauses.push('p.status=?');
    params.push(filters.status);
  }
  if (filters.country) {
    clauses.push('LOWER(p.country)=LOWER(?)');
    params.push(filters.country);
  }
  if (filters.search) {
    clauses.push('(p.name LIKE ? OR p.host LIKE ? OR p.country LIKE ?)');
    const term = `%${String(filters.search).slice(0, 100)}%`;
    params.push(term, term, term);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return queryWithCounts(`${where} ORDER BY p.id DESC`, params).map(publicView);
}

function get(id) {
  requireInit();
  return publicView(queryWithCounts('WHERE p.id=?', [Number(id)])[0]);
}

function create(data = {}) {
  requireInit();
  const host = validateHost(data.host);
  const port = validatePort(data.port);
  const protocol = cleanText(data.protocol, 16) || 'http';
  if (!VALID_PROTOCOLS.has(protocol)) throw new Error('Solo se admite proxy HTTP en esta versión');
  const status = cleanText(data.status, 16) || 'active';
  if (!VALID_STATUSES.has(status)) throw new Error('Estado de proxy inválido');
  const username = cleanText(data.username, 255);
  const duplicate = DB.get(`
    SELECT id FROM proxies
    WHERE host=? AND port=? AND COALESCE(username,'')=COALESCE(?,'')
    LIMIT 1
  `, [host, port, username]);
  if (duplicate) throw new Error('Ese proxy ya existe en el pool');
  const timestamp = now();
  try {
    const result = DB.run(`
      INSERT INTO proxies(
        name,host,port,protocol,username,password_enc,country,tags,status,max_devices,
        failure_count,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      cleanText(data.name, 120), host, port, protocol, username,
      encrypt(data.password), cleanText(data.country, 80),
      JSON.stringify(normalizeTags(data.tags)), status, validateMaxDevices(data.max_devices),
      0, timestamp, timestamp,
    ]);
    return get(result.lastInsertRowid);
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(error.message)) {
      throw new Error('Ese proxy ya existe en el pool');
    }
    throw error;
  }
}

function update(id, data = {}) {
  requireInit();
  const current = DB.get('SELECT * FROM proxies WHERE id=?', [Number(id)]);
  if (!current) return null;
  const protocol = data.protocol == null ? current.protocol : cleanText(data.protocol, 16);
  const status = data.status == null ? current.status : cleanText(data.status, 16);
  if (!VALID_PROTOCOLS.has(protocol)) throw new Error('Solo se admite proxy HTTP en esta versión');
  if (!VALID_STATUSES.has(status)) throw new Error('Estado de proxy inválido');
  const passwordEnc = data.password === undefined || data.password === ''
    ? current.password_enc
    : encrypt(data.password);
  DB.run(`
    UPDATE proxies SET
      name=?, host=?, port=?, protocol=?, username=?, password_enc=?, country=?, tags=?,
      status=?, max_devices=?, updated_at=?
    WHERE id=?
  `, [
    data.name === undefined ? current.name : cleanText(data.name, 120),
    data.host === undefined ? current.host : validateHost(data.host),
    data.port === undefined ? current.port : validatePort(data.port),
    protocol,
    data.username === undefined ? current.username : cleanText(data.username, 255),
    passwordEnc,
    data.country === undefined ? current.country : cleanText(data.country, 80),
    data.tags === undefined ? current.tags : JSON.stringify(normalizeTags(data.tags)),
    status,
    data.max_devices === undefined ? current.max_devices : validateMaxDevices(data.max_devices),
    now(),
    Number(id),
  ]);
  return get(id);
}

function remove(id) {
  requireInit();
  const numericId = Number(id);
  const active = DB.get('SELECT COUNT(*) AS count FROM proxy_assignments WHERE proxy_id=? AND active=1', [numericId]);
  if (active && active.count > 0) throw new Error('No se puede eliminar un proxy con dispositivos asignados');
  DB.run('DELETE FROM proxy_assignments WHERE proxy_id=?', [numericId]);
  return DB.run('DELETE FROM proxies WHERE id=?', [numericId]).changes > 0;
}

function importBulk(rows) {
  if (!Array.isArray(rows)) throw new Error('Se espera un array de proxies');
  const result = { imported: 0, rejected: [] };
  rows.slice(0, 10000).forEach((row, index) => {
    try {
      create(row || {});
      result.imported += 1;
    } catch (error) {
      result.rejected.push({ row: index + 1, message: error.message });
    }
  });
  return result;
}

function activeAssignment(deviceId) {
  requireInit();
  const row = DB.get(`
    SELECT pa.*, p.id AS proxy_id, p.name, p.host, p.port, p.protocol, p.username, p.password_enc,
      p.country, p.tags, p.status, p.max_devices
    FROM proxy_assignments pa
    JOIN proxies p ON p.id=pa.proxy_id
    WHERE pa.device_id=? AND pa.active=1
    ORDER BY pa.id DESC LIMIT 1
  `, [Number(deviceId)]);
  if (!row) return null;
  return {
    assignment_id: row.id,
    device_id: row.device_id,
    proxy: publicView({ ...row, id: row.proxy_id }),
    assigned_at: row.assigned_at,
    reason: row.reason,
  };
}

function proxySecrets(proxyId) {
  const row = DB.get('SELECT * FROM proxies WHERE id=?', [Number(proxyId)]);
  if (!row) return null;
  return { ...row, password: decrypt(row.password_enc) };
}

function candidate(options = {}, excludedProxyId = null) {
  const strategy = VALID_STRATEGIES.has(options.strategy) ? options.strategy : 'round_robin';
  const clauses = [
    "p.status='active'",
    '(SELECT COUNT(*) FROM proxy_assignments pa WHERE pa.proxy_id=p.id AND pa.active=1) < p.max_devices',
  ];
  const params = [];
  if (excludedProxyId != null) {
    clauses.push('p.id<>?');
    params.push(Number(excludedProxyId));
  }
  if (options.proxy_id != null) {
    clauses.push('p.id=?');
    params.push(Number(options.proxy_id));
  }
  if (options.country) {
    clauses.push('LOWER(p.country)=LOWER(?)');
    params.push(String(options.country));
  }
  const tags = normalizeTags(options.tags);
  for (const tag of tags) {
    clauses.push('p.tags LIKE ?');
    params.push(`%"${tag.replace(/[%_]/g, '')}"%`);
  }
  const order = strategy === 'random'
    ? 'RANDOM()'
    : 'p.last_used_at IS NULL DESC, p.last_used_at ASC, p.id ASC';
  return DB.get(`SELECT p.* FROM proxies p WHERE ${clauses.join(' AND ')} ORDER BY ${order} LIMIT 1`, params);
}

function reserve(deviceId, proxy, reason) {
  const timestamp = now();
  const result = DB.run(`
    INSERT INTO proxy_assignments(proxy_id,device_id,active,reason,assigned_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)
  `, [proxy.id, Number(deviceId), 1, cleanText(reason, 120), timestamp, timestamp, timestamp]);
  DB.run('UPDATE proxies SET last_used_at=?, updated_at=? WHERE id=?', [timestamp, timestamp, proxy.id]);
  return result.lastInsertRowid;
}

function releaseAssignment(assignmentId) {
  if (!assignmentId) return;
  DB.run(`
    UPDATE proxy_assignments SET active=0,released_at=?,updated_at=?
    WHERE id=? AND active=1
  `, [now(), now(), Number(assignmentId)]);
}

async function applyProxy(device, proxy) {
  if (!dispatch) throw new Error('No hay despachador de comandos configurado');
  if (proxy.username || proxy.password_enc) {
    return {
      success: false,
      message: 'Android por ADB no admite autenticación en el proxy HTTP global',
    };
  }
  return dispatch(device.serial_number, 'SET_PROXY', { host: proxy.host, port: proxy.port });
}

async function assignAndApply(device, options = {}) {
  requireInit();
  if (!device || !device.id || !device.serial_number) throw new Error('Dispositivo inválido');
  const previous = activeAssignment(device.id);
  if (
    previous
    && options.exclude_current === false
    && options.proxy_id != null
    && Number(options.proxy_id) === Number(previous.proxy.id)
  ) {
    const currentProxy = proxySecrets(previous.proxy.id);
    const applied = await applyProxy(device, currentProxy);
    return {
      success: !!(applied && applied.success),
      message: applied && applied.success
        ? `Proxy ${currentProxy.host}:${currentProxy.port} reaplicado`
        : (applied && applied.message) || 'No se pudo reaplicar el proxy',
      data: { assignment: previous, applied },
    };
  }
  const selected = candidate(options, options.exclude_current === false ? null : previous?.proxy?.id);
  if (!selected) {
    return { success: false, message: 'No hay proxies disponibles con esa capacidad/filtro' };
  }

  if (previous) releaseAssignment(previous.assignment_id);
  let assignmentId;
  try {
    assignmentId = reserve(device.id, selected, options.reason || 'manual');
  } catch (error) {
    if (previous) reserve(device.id, proxySecrets(previous.proxy.id), 'rollback-reservation');
    throw error;
  }

  const applied = await applyProxy(device, selected);
  if (!applied || !applied.success) {
    releaseAssignment(assignmentId);
    DB.run(`
      UPDATE proxies SET status='error',failure_count=failure_count+1,last_error=?,
        last_checked_at=?,updated_at=? WHERE id=?
    `, [(applied && applied.message) || 'No se pudo aplicar', now(), now(), selected.id]);
    if (previous) {
      const old = proxySecrets(previous.proxy.id);
      if (old) {
        reserve(device.id, old, 'rollback-apply');
        await applyProxy(device, old);
      }
    }
    return {
      success: false,
      message: (applied && applied.message) || 'No se pudo aplicar el proxy',
      data: { proxy: publicView(selected), rolled_back: !!previous },
    };
  }

  DB.run(`
    UPDATE devices SET proxy_host=?,proxy_port=?,proxy_user=NULL,proxy_pass=NULL,
      proxy_enabled=1,updated_at=? WHERE id=?
  `, [selected.host, selected.port, now(), device.id]);
  DB.run(`
    UPDATE proxies SET status='active',failure_count=0,last_error=NULL,
      last_checked_at=?,updated_at=? WHERE id=?
  `, [now(), now(), selected.id]);
  return {
    success: true,
    message: `Proxy ${selected.host}:${selected.port} asignado`,
    data: { assignment: activeAssignment(device.id), applied },
  };
}

async function clearAndRelease(device, reason = 'manual') {
  requireInit();
  if (!device || !device.id || !device.serial_number) throw new Error('Dispositivo inválido');
  const applied = dispatch
    ? await dispatch(device.serial_number, 'CLEAR_PROXY', {})
    : { success: false, message: 'No hay despachador de comandos configurado' };
  if (!applied || !applied.success) {
    return { success: false, message: (applied && applied.message) || 'No se pudo quitar el proxy' };
  }
  const current = activeAssignment(device.id);
  if (current) releaseAssignment(current.assignment_id);
  DB.run(`
    UPDATE devices SET proxy_host=NULL,proxy_port=NULL,proxy_user=NULL,proxy_pass=NULL,
      proxy_enabled=0,updated_at=? WHERE id=?
  `, [now(), device.id]);
  return { success: true, message: `Proxy eliminado (${reason})`, data: { applied } };
}

async function checkIp(device) {
  requireInit();
  if (!device || !device.id || !device.serial_number) throw new Error('Dispositivo inválido');
  const result = await dispatch(device.serial_number, 'CHECK_IP', {});
  const assignment = activeAssignment(device.id);
  const externalIp = result && result.data && (result.data.external_ip || result.data.local_ip);
  if (result && result.success) {
    if (externalIp) {
      DB.run('UPDATE devices SET last_ip=?,last_ip_at=?,updated_at=? WHERE id=?', [externalIp, now(), now(), device.id]);
    }
    if (assignment) {
      DB.run(`
        UPDATE proxies SET status='active',failure_count=0,last_error=NULL,
          last_checked_at=?,updated_at=? WHERE id=?
      `, [now(), now(), assignment.proxy.id]);
    }
  } else if (assignment) {
    DB.run(`
      UPDATE proxies SET failure_count=failure_count+1,last_error=?,last_checked_at=?,updated_at=?
      WHERE id=?
    `, [(result && result.message) || 'Fallo comprobando IP', now(), now(), assignment.proxy.id]);
  }
  return result;
}

async function distribute(devices, options = {}) {
  if (!Array.isArray(devices) || !devices.length) throw new Error('No hay dispositivos para distribuir');
  const results = await Promise.all(devices.map(async device => {
    try {
      const result = await assignAndApply(device, { ...options, reason: options.reason || 'distribution' });
      return { device_id: device.id, serial_number: device.serial_number, ...result };
    } catch (error) {
      return { device_id: device.id, serial_number: device.serial_number, success: false, message: error.message };
    }
  }));
  return {
    assigned: results.filter(result => result.success).length,
    failed: results.filter(result => !result.success).length,
    results,
  };
}

module.exports = {
  init,
  list,
  get,
  create,
  update,
  remove,
  importBulk,
  activeAssignment,
  assignAndApply,
  clearAndRelease,
  checkIp,
  distribute,
  publicView,
};
