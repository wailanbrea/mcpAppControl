// Ajustes generales de operación (humanización + salud de hardware).
// Persisten en settings.json junto a la BD.
const fs = require('fs');
const path = require('path');

let file = null;
let cfg = {
  // Comportamiento humano (OPT-IN: por defecto off para que el control sea preciso
  // y ágil; actívalo en Ajustes para anti-detección al ejecutar rutinas de granja).
  humanize_enabled: false,
  jitter_min_ms: 500,        // pausa aleatoria mínima entre pasos
  jitter_max_ms: 2500,       // pausa aleatoria máxima entre pasos
  tap_jitter_px: 8,          // desplazamiento aleatorio del toque (px)
  swipe_variance: 0.35,      // variación de duración de swipe/scroll (0-1)
  // Salud de hardware
  hw_enabled: false,         // sondeo periódico de batería/temp/almacenamiento
  hw_interval_sec: 300,
  battery_min: 20,           // %
  temp_max_c: 45,            // °C
  storage_min_mb: 500,       // MB libres
};

function init(db) {
  const dir = path.dirname(db.file && db.file !== ':memory:' ? db.file : __dirname);
  file = path.join(dir, 'settings.json');
  try { if (fs.existsSync(file)) cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (_) {}
}
function get() { return { ...cfg }; }
function set(patch) {
  if (patch && typeof patch === 'object') {
    for (const k of Object.keys(cfg)) if (patch[k] !== undefined) cfg[k] = patch[k];
    try { fs.writeFileSync(file, JSON.stringify(cfg, null, 2)); } catch (_) {}
  }
  return get();
}

// ---------- helpers de humanización (deterministas salvo el azar) ----------
const rnd = (a, b) => a + Math.random() * (b - a);
function interStepDelayMs() {
  if (!cfg.humanize_enabled) return 0;
  return Math.round(rnd(cfg.jitter_min_ms, cfg.jitter_max_ms));
}
function jitterXY(x, y) {
  if (!cfg.humanize_enabled || !cfg.tap_jitter_px) return { x, y };
  const j = cfg.tap_jitter_px;
  return { x: Math.max(0, Math.round(x + rnd(-j, j))), y: Math.max(0, Math.round(y + rnd(-j, j))) };
}
function varyDuration(baseMs) {
  if (!cfg.humanize_enabled || !cfg.swipe_variance) return baseMs;
  return Math.max(50, Math.round(baseMs * rnd(1 - cfg.swipe_variance, 1 + cfg.swipe_variance)));
}

module.exports = { init, get, set, interStepDelayMs, jitterXY, varyDuration };
