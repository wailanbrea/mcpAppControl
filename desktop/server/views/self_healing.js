// Módulo de Auto-Curación y Resiliencia (Fase 6)
// Este módulo define las reglas de recuperación automática para la granja.
const { now } = require('./db');
const alerts = require('./alerts');

let DB = null;
let dispatch = null;

function init(db, opts = {}) {
  DB = db;
  dispatch = opts.dispatch;
}

/**
 * Determina si un error debe disparar una acción de auto-curación.
 * @param {string} errorType - Tipo de error detectado (ej: 'ADB_DISCONNECT', 'APP_CRASH', 'CAPTCHA', 'PROXY_LEAK')
 * @param {Object} context - Información adicional del contexto de ejecución.
 */
function getHealingAction(errorType, context) {
  switch (errorType) {
    case 'ADB_DISCONNECT':
      return { action: 'RECONNECT', retryCount: 3, delay: 5000 };
    case 'APP_CRASH':
    case 'EXECUTION_FAILED':
      return { action: 'RESTART_TASK', retryCount: 2, delay: 10000 };
    case 'CAPTCHA':
      return { action: 'MARK_FOR_MANUAL', retryCount: 0, delay: 0 };
    case 'PROXY_LEAK':
      return { action: 'DISABLE_DEVICE', retryCount: 0, delay: 0 };
    default:
      return { action: 'LOG_ONLY', retryCount: 0, delay: 0 };
  }
}

/**
 * Ejecuta la acción de curación correspondiente.
 */
async function performHealing(device, action, context) {
  const { serial, id } = device;
  console.log(`[self-healing] Ejecutando ${action} para ${serial}`);

  switch (action) {
    case 'RECONNECT':
      try {
        await dispatch(serial, 'RECONNECT_ADB', {});
        DB.run(`UPDATE devices SET status='online', last_seen=?, updated_at=? WHERE id=?`, [now(), now(), id]);
        return { success: true, message: 'Reconexión exitosa' };
      } catch (e) {
        return { success: false, message: 'Fallo al reconectar' };
      }

    case 'RESTART_TASK':
      // La lógica de reinicio se maneja en el loop principal del scheduler
      // pero aquí notificamos el intento.
      return { success: true, message: 'Tarea marcada para reinicio' };

    case 'MARK_FOR_MANUAL':
      DB.run(`UPDATE devices SET status='error', flag_reason='Captcha Detectado', flag_category='captcha', updated_at=? WHERE id=?`, [now(), id]);
      await alerts.notify({
        type: 'device_healing',
        severity: 'warning',
        device_serial: serial,
        message: `${serial}: Captcha detectado. Dispositivo puesto en espera manual.`
      });
      return { success: true, message: 'Dispositivo pausado por Captcha' };

    case 'DISABLE_DEVICE':
      DB.run(`UPDATE devices SET status='offline', flag_reason='Proxy Leak', flag_category='proxy', updated_at=? WHERE id=?`, [now(), id]);
      await alerts.notify({
        type: 'device_healing',
        severity: 'critical',
        device_serial: serial,
        message: `${serial}: Fuga de IP detectada. Dispositivo desactivado por seguridad.`
      });
      return { success: true, message: 'Dispositivo desactivado por seguridad' };

    default:
      return { success: true, message: 'Sin acción automática' };
  }
}

module.exports = { init, getHealingAction, performHealing };
