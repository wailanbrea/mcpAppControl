// Alertas: registra notificaciones en la BD y las reenvía a canales externos
// (webhook y/o Telegram). La configuración se guarda en alerts-config.json junto a la BD.
const fs = require('fs');
const path = require('path');
const { now } = require('./db');

let DB = null;
let cfgFile = null;
let cfg = {
  enabled: true,
  webhook_url: '',
  telegram_token: '',
  telegram_chat_id: '',
  monitor_enabled: false,      // sondeo periódico de baneo (opt-in)
  monitor_interval_sec: 120,
  auto_pause_on_flag: true,    // marcar/pausar dispositivo al detectar
};

function init(db) {
  DB = db;
  const dir = path.dirname(db.file && db.file !== ':memory:' ? db.file : __dirname);
  cfgFile = path.join(dir, 'alerts-config.json');
  load();
}
function load() {
  try { if (fs.existsSync(cfgFile)) cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(cfgFile, 'utf8'))); } catch (_) {}
}
function save() { try { fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2)); } catch (_) {} }

function getConfig() {
  // No devolvemos el token en claro; indicamos si está configurado.
  return {
    enabled: cfg.enabled,
    webhook_url: cfg.webhook_url,
    telegram_token_set: !!cfg.telegram_token,
    telegram_chat_id: cfg.telegram_chat_id,
    monitor_enabled: cfg.monitor_enabled,
    monitor_interval_sec: cfg.monitor_interval_sec,
    auto_pause_on_flag: cfg.auto_pause_on_flag,
  };
}
function setConfig(patch) {
  if (!patch || typeof patch !== 'object') return getConfig();
  const allowed = ['enabled', 'webhook_url', 'telegram_token', 'telegram_chat_id', 'monitor_enabled', 'monitor_interval_sec', 'auto_pause_on_flag'];
  for (const k of allowed) if (patch[k] !== undefined) cfg[k] = patch[k];
  // permitir borrar el token con cadena vacía explícita
  save();
  return getConfig();
}
function raw() { return cfg; }

// Registra una notificación y la reenvía a los canales configurados.
async function notify({ type = 'info', message, severity = 'info', device_serial = null, data = {} }) {
  try {
    DB.run('INSERT INTO notifications(type, message, data, read, sent_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      [type, message, JSON.stringify({ ...data, severity, device_serial }), 0, now(), now(), now()]);
  } catch (e) { console.error('[alerts] db', e.message); }
  try { const router = require('../router'); router.broadcast('notification', { type, message, severity, device_serial }); } catch (_) {}

  if (!cfg.enabled) return;
  const label = `[${String(severity).toUpperCase()}] ${message}${device_serial ? ` · ${device_serial}` : ''}`;
  if (cfg.webhook_url) {
    fetch(cfg.webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, message, severity, device_serial, data, ts: now() }) }).catch(() => {});
  }
  if (cfg.telegram_token && cfg.telegram_chat_id) {
    fetch(`https://api.telegram.org/bot${cfg.telegram_token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.telegram_chat_id, text: label }),
    }).catch(() => {});
  }
}

module.exports = { init, getConfig, setConfig, raw, notify };
