// Monitor de salud de cuentas: lee el texto de la pantalla del dispositivo y
// busca señales de baneo, captcha, verificación, límite de tasa o cierre de sesión.
// Al detectar: marca el dispositivo, opcionalmente lo pausa y dispara una alerta.
const { now } = require('./db');
const alerts = require('./alerts');

let DB = null;
let dispatch = null;   // fn(serial, command, params) -> {success, data}

function init(db, opts = {}) { DB = db; dispatch = opts.dispatch; }

// Catálogo de patrones (ES/EN). severity: critical | warning.
const PATTERNS = [
  { category: 'captcha', severity: 'critical', re: /\b(captcha|recaptcha|hcaptcha|no soy un robot|i'?m not a robot|verify you'?re human|confirm you'?re not a robot|selecciona (todas )?las im[aá]genes|press & hold|mant[eé]n pulsado)\b/i },
  { category: 'verification', severity: 'critical', re: /(verify (your|it'?s you|your identity)|confirm your identity|verifica tu (identidad|cuenta)|verificaci[oó]n|unusual (login|activity)|actividad inusual|suspicious (login|activity)|enter the code|c[oó]digo de verificaci[oó]n|two[- ]?factor|autenticaci[oó]n en dos pasos|we sent a code|te enviamos un c[oó]digo)/i },
  { category: 'ban', severity: 'critical', re: /((account|cuenta)[^.!?\n]{0,30}(suspend|disabled|banned|terminated|restrict|suspendid|inhabilitad|deshabilitad|banead|eliminad|restringid)|permanently banned|we removed your account|has violado|you violated|community guidelines|normas de la comunidad)/i },
  { category: 'rate_limit', severity: 'warning', re: /(try again later|too many (attempts|requests)|slow down|has alcanzado el l[ií]mite|demasiados intentos|action blocked|acci[oó]n bloqueada|please wait a few (minutes|hours)|espera unos (minutos|momentos)|rate[- ]?limit|l[ií]mite de (acciones|seguimiento))/i },
  { category: 'login', severity: 'warning', re: /(log ?in to continue|inicia sesi[oó]n para continuar|session expired|sesi[oó]n (expirada|caducada|finalizada)|please sign in|you'?ve been logged out|has cerrado sesi[oó]n|vuelve a iniciar sesi[oó]n)/i },
];

// Escanea un texto y devuelve la primera coincidencia (o null). Función pura → testeable.
function scanText(text) {
  if (!text) return null;
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m) return { category: p.category, severity: p.severity, matched: m[0] };
  }
  return null;
}

// Lee la pantalla del dispositivo y la analiza. Devuelve la detección o null.
async function checkDevice(device, meta = {}) {
  if (!dispatch) return null;
  const serial = device.serial_number || device.adb_serial;
  let res;
  try { res = await dispatch(serial, 'READ_SCREEN_TEXT', {}); } catch (_) { return null; }
  const text = res && res.data && res.data.text;
  const hit = scanText(text);
  if (hit) await handleFlag(device, hit, meta);
  return hit;
}

// Marca el dispositivo, dispara alerta y (si procede) lo pausa.
async function handleFlag(device, hit, meta = {}) {
  const cfg = alerts.raw();
  const reason = `${hit.category}: "${hit.matched}"`;
  try {
    DB.run('UPDATE devices SET flagged=1, flag_reason=?, flag_category=?, flagged_at=?, updated_at=? WHERE id=?',
      [reason, hit.category, now(), now(), device.id]);
    if (cfg.auto_pause_on_flag) DB.run("UPDATE devices SET status='error', current_task_id=NULL WHERE id=?", [device.id]);
  } catch (e) { console.error('[monitor] flag', e.message); }
  await alerts.notify({
    type: 'device_flagged',
    severity: hit.severity,
    device_serial: device.serial_number,
    message: `${device.name || device.serial_number}: ${labelES(hit.category)} detectado${cfg.auto_pause_on_flag ? ' — dispositivo pausado' : ''}`,
    data: { category: hit.category, matched: hit.matched, source: meta.source || 'monitor' },
  });
  console.log(`[monitor] ${device.serial_number} marcado: ${reason}`);
}
function labelES(c) {
  return ({ captcha: 'Captcha', verification: 'Verificación', ban: 'Baneo/Suspensión', rate_limit: 'Límite de tasa', login: 'Cierre de sesión' })[c] || c;
}

// Tick periódico (opt-in): revisa todos los dispositivos ADB en línea no marcados.
let _running = false;
async function tick() {
  const cfg = alerts.raw();
  if (!cfg.monitor_enabled || _running) return;
  _running = true;
  try {
    const devs = DB.all("SELECT * FROM devices WHERE status='online' AND adb_serial IS NOT NULL AND (flagged IS NULL OR flagged=0)");
    for (const d of devs) {
      try { await checkDevice(d, { source: 'monitor' }); } catch (_) {}
    }
  } finally { _running = false; }
}

function clearFlag(deviceId) {
  DB.run('UPDATE devices SET flagged=0, flag_reason=NULL, flag_category=NULL, flagged_at=NULL, updated_at=? WHERE id=?', [now(), deviceId]);
}

// ---------- salud de hardware ----------
const _healthAlerted = new Map(); // `${id}:${type}` -> ts, para no repetir alerta cada tick
function _shouldAlert(key) {
  const last = _healthAlerted.get(key) || 0;
  if (Date.now() - last < 30 * 60000) return false; // máx 1 alerta/30min por tipo
  _healthAlerted.set(key, Date.now());
  return true;
}
let _hwRunning = false;
async function healthTick() {
  if (!dispatch || _hwRunning) return;
  const settings = require('./settings'); const s = settings.get();
  if (!s.hw_enabled) return;
  _hwRunning = true;
  try {
    const devs = DB.all("SELECT * FROM devices WHERE status IN ('online','busy') AND adb_serial IS NOT NULL");
    for (const d of devs) {
      try {
        const rr = await dispatch(d.serial_number, 'DEVICE_HEALTH', {});
        if (!rr || !rr.data) continue;
        const h = rr.data;
        DB.run('UPDATE devices SET battery_level=?, temperature_c=?, storage_free_mb=?, charging=?, health_at=?, updated_at=? WHERE id=?',
          [h.battery ?? null, h.temperature_c ?? null, h.storage_free_mb ?? null, h.charging ?? null, now(), now(), d.id]);
        const name = d.name || d.serial_number;
        if (h.battery != null && h.battery < s.battery_min && !h.charging && _shouldAlert(`${d.id}:bat`))
          await alerts.notify({ type: 'hw_battery', severity: 'warning', device_serial: d.serial_number, message: `${name}: batería baja (${h.battery}%)`, data: h });
        if (h.temperature_c != null && h.temperature_c > s.temp_max_c && _shouldAlert(`${d.id}:temp`))
          await alerts.notify({ type: 'hw_temp', severity: 'warning', device_serial: d.serial_number, message: `${name}: temperatura alta (${h.temperature_c}°C)`, data: h });
        if (h.storage_free_mb != null && h.storage_free_mb < s.storage_min_mb && _shouldAlert(`${d.id}:sto`))
          await alerts.notify({ type: 'hw_storage', severity: 'warning', device_serial: d.serial_number, message: `${name}: almacenamiento bajo (${h.storage_free_mb} MB)`, data: h });
      } catch (_) {}
    }
  } finally { _hwRunning = false; }
}

module.exports = { init, scanText, checkDevice, tick, healthTick, clearFlag, PATTERNS };
