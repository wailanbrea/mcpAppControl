// Motor de Views Multi-Plataforma (Fase 1)
// Patrones específicos por plataforma: TikTok, YouTube, Instagram Reels, X/Twitter
const crypto = require('crypto');
const { now } = require('./db');

let DB = null;
function init(db) { DB = db; }

// ---- Utilidades de azar determinista ----
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min, max) => +(Math.random() * (max - min) + min).toFixed(2);

// ---- Patrones de view por plataforma ----
// Cada patrón devuelve un array de pasos ADB que simulan una vista orgánica.

/**
 * Patrón TikTok: abrir app → scroll feed (5-10 videos) → like aleatorio → volver al home.
 * Duración total: 45-90 segundos por video.
 */
function tiktokPattern(config = {}) {
  const viewsPerSession = config.views_per_session || randInt(3, 8);
  const durationMs = config.video_duration_ms || randInt(45000, 90000);
  const likeChance = config.like_chance ?? 0.15; // 15% probabilidad de dar like por video
  const followChance = config.follow_chance ?? 0.03;
  const commentTexts = config.comment_texts || ['😍', 'Increíble 🔥', 'Me encanta ❤️', 'Jajaja 😂', 'WOW'];

  const steps = [];

  // Abrir TikTok
  steps.push({ type: 'OPEN_APP', package_name: 'com.zhiliaoapp.musically' });
  steps.push({ type: 'WAIT', duration: randInt(3000, 5000) });

  for (let v = 0; v < viewsPerSession; v++) {
    // Scroll para cambiar de video (swipe up en TikTok es scroll down)
    const scrolls = randInt(2, 4);
    for (let s = 0; s < scrolls; s++) {
      steps.push({ type: 'SCROLL', direction: 'down' });
      steps.push({ type: 'WAIT', duration: randInt(durationMs / scrolls - 1000, durationMs / scrolls + 500) });
    }

    // Like aleatorio (tap en corazón ~centro-derecha de pantalla)
    if (Math.random() < likeChance) {
      steps.push({ type: 'TAP_XY', x: randInt(280, 340), y: randInt(650, 750) });
      steps.push({ type: 'WAIT', duration: randInt(1000, 2000) });
    }

    // Follow aleatorio (botón + ~derecha arriba)
    if (Math.random() < followChance && v === viewsPerSession - 1) {
      steps.push({ type: 'TAP_XY', x: randInt(350, 420), y: randInt(80, 160) });
      steps.push({ type: 'WAIT', duration: randInt(1500, 3000) });
    }

    // Comentario aleatorio (1 en 5 sesiones)
    if (Math.random() < 0.2 && v === viewsPerSession - 1) {
      const comment = commentTexts[randInt(0, commentTexts.length - 1)];
      steps.push({ type: 'TAP_XY', x: randInt(350, 420), y: randInt(780, 860) }); // icono comentario
      steps.push({ type: 'WAIT', duration: randInt(1000, 2000) });
      steps.push({ type: 'SET_TEXT', resource_id: 'com.zhiliaoapp.musically:id/caption_editor_edit_text', value: comment });
      steps.push({ type: 'WAIT', duration: randInt(500, 1500) });
      steps.push({ type: 'TAP_XY', x: randInt(380, 420), y: randInt(760, 820) }); // botón publicar
    }

    // Pausa "humana" entre videos (mirar la pantalla un momento)
    steps.push({ type: 'WAIT', duration: randInt(1500, 4000) });
  }

  // Volver al home
  steps.push({ type: 'PRESS_HOME' });
  return { platform: 'tiktok', pattern: 'feed_scroll', steps };
}

/**
 * Patrón YouTube: abrir app → buscar/navegar → reproducir video (watch) → loop.
 * Duración total: 30-120 segundos por video.
 */
function youtubePattern(config = {}) {
  const viewsPerSession = config.views_per_session || randInt(2, 5);
  const watchDurationMs = config.watch_duration_ms || randInt(30000, 120000);
  const likeChance = config.like_chance ?? 0.1;
  const subscribeChance = config.subscribe_chance ?? 0.02;

  const steps = [];

  // Abrir YouTube
  steps.push({ type: 'OPEN_APP', package_name: 'com.google.android.youtube' });
  steps.push({ type: 'WAIT', duration: randInt(3000, 5000) });

  for (let v = 0; v < viewsPerSession; v++) {
    // Navegar a contenido (scroll feed o búsqueda)
    if (v === 0) {
      // Primera vez: buscar en la pestaña Explore/Shorts
      steps.push({ type: 'TAP_XY', x: randInt(180, 240), y: randInt(950, 1030) }); // Shorts tab
      steps.push({ type: 'WAIT', duration: randInt(2000, 4000) });
    }

    // Scroll para ver shorts/videos (swipe up = scroll down en YouTube Shorts)
    const scrolls = randInt(1, 3);
    for (let s = 0; s < scrolls; s++) {
      steps.push({ type: 'SCROLL', direction: 'down' });
      steps.push({ type: 'WAIT', duration: randInt(watchDurationMs / scrolls - 500, watchDurationMs / scrolls + 500) });
    }

    // Like aleatorio (botón like ~centro-izquierda debajo del video)
    if (Math.random() < likeChance) {
      steps.push({ type: 'TAP_XY', x: randInt(120, 180), y: randInt(750, 830) });
      steps.push({ type: 'WAIT', duration: randInt(1000, 2000) });
    }

    // Subscribe aleatorio
    if (Math.random() < subscribeChance && v === viewsPerSession - 1) {
      steps.push({ type: 'TAP_XY', x: randInt(350, 420), y: randInt(860, 920) }); // Subscribe button
      steps.push({ type: 'WAIT', duration: randInt(1500, 3000) });
    }

    // Pausa entre videos
    steps.push({ type: 'WAIT', duration: randInt(2000, 5000) });
  }

  steps.push({ type: 'PRESS_HOME' });
  return { platform: 'youtube', pattern: 'shorts_watch', steps };
}

/**
 * Patrón Instagram Reels: abrir app → navegar a Reels → scroll + engagement.
 * Duración total: 15-45 segundos por reel.
 */
function instagramPattern(config = {}) {
  const viewsPerSession = config.views_per_session || randInt(3, 8);
  const durationMs = config.video_duration_ms || randInt(15000, 45000);
  const likeChance = config.like_chance ?? 0.2;
  const commentChance = config.comment_chance ?? 0.08;

  const steps = [];

  // Abrir Instagram
  steps.push({ type: 'OPEN_APP', package_name: 'com.instagram.android' });
  steps.push({ type: 'WAIT', duration: randInt(3000, 5000) });

  for (let v = 0; v < viewsPerSession; v++) {
    // Scroll para cambiar de reel (swipe up)
    const scrolls = randInt(1, 2);
    for (let s = 0; s < scrolls; s++) {
      steps.push({ type: 'SCROLL', direction: 'down' });
      steps.push({ type: 'WAIT', duration: randInt(durationMs / scrolls - 500, durationMs / scrolls + 1000) });
    }

    // Like aleatorio (corazón ~derecha centro)
    if (Math.random() < likeChance) {
      steps.push({ type: 'TAP_XY', x: randInt(340, 400), y: randInt(580, 680) });
      steps.push({ type: 'WAIT', duration: randInt(1000, 2000) });
    }

    // Comentario aleatorio (DM o comentario directo)
    if (Math.random() < commentChance && v === viewsPerSession - 1) {
      const comments = ['❤️', '🔥🔥', 'Amazing!', 'Love this 😍'];
      steps.push({ type: 'TAP_XY', x: randInt(340, 400), y: randInt(720, 800) }); // comment icon
      steps.push({ type: 'WAIT', duration: randInt(1500, 3000) });
    }

    // Pausa entre reels
    steps.push({ type: 'WAIT', duration: randInt(1000, 3000) });
  }

  steps.push({ type: 'PRESS_HOME' });
  return { platform: 'instagram', pattern: 'reels_scroll', steps };
}

/**
 * Patrón X/Twitter: abrir app → scroll timeline → like/retweet aleatorio.
 * Duración total: 10-30 segundos por post.
 */
function twitterPattern(config = {}) {
  const viewsPerSession = config.views_per_session || randInt(5, 15);
  const durationMs = config.post_duration_ms || randInt(10000, 30000);
  const likeChance = config.like_chance ?? 0.12;
  const retweetChance = config.retweet_chance ?? 0.04;

  const steps = [];

  // Abrir X/Twitter
  steps.push({ type: 'OPEN_APP', package_name: 'com.twitter.android' });
  steps.push({ type: 'WAIT', duration: randInt(3000, 5000) });

  for (let v = 0; v < viewsPerSession; v++) {
    // Scroll timeline (swipe up para ver más)
    const scrolls = randInt(1, 2);
    for (let s = 0; s < scrolls; s++) {
      steps.push({ type: 'SCROLL', direction: 'down' });
      steps.push({ type: 'WAIT', duration: randInt(durationMs / scrolls - 500, durationMs / scrolls + 1000) });
    }

    // Like aleatorio (corazón ~derecha)
    if (Math.random() < likeChance) {
      steps.push({ type: 'TAP_XY', x: randInt(320, 380), y: randInt(450, 600) });
      steps.push({ type: 'WAIT', duration: randInt(1000, 2000) });
    }

    // Retweet aleatorio
    if (Math.random() < retweetChance && v === viewsPerSession - 1) {
      steps.push({ type: 'TAP_XY', x: randInt(260, 320), y: randInt(450, 600) }); // retweet icon
      steps.push({ type: 'WAIT', duration: randInt(1000, 2000) });
    }

    // Pausa entre posts
    steps.push({ type: 'WAIT', duration: randInt(800, 2500) });
  }

  steps.push({ type: 'PRESS_HOME' });
  return { platform: 'twitter', pattern: 'timeline_scroll', steps };
}

// ---- Mapeo de plataforma a patrón ----
const PATTERN_MAP = {
  tiktok: tiktokPattern,
  youtube: youtubePattern,
  instagram: instagramPattern,
  twitter: twitterPattern,
};

/**
 * Genera los pasos para una vista según la plataforma.
 */
function generateViewSteps(platform, config) {
  const fn = PATTERN_MAP[platform];
  if (!fn) throw new Error(`Plataforma no soportada: ${platform}. Soportadas: ${Object.keys(PATTERN_MAP).join(', ')}`);
  return fn(config || {});
}

// ---- Ejecución de patrón en un dispositivo ----
/**
 * Ejecuta un patrón de views en un dispositivo.
 * @param {object} device - Objeto dispositivo con serial_number, adb_serial
 * @param {string} platform - Plataforma objetivo
 * @param {object} config - Configuración del patrón (views_per_session, etc.)
 * @returns {Promise<object>} Resultado de la ejecución
 */
async function executeViewPattern(device, platform, config) {
  const pattern = generateViewSteps(platform, config);
  const steps = pattern.steps;

  // Inyectar USE_ACCOUNT si hay cuenta asignada
  if (device.account_id) {
    steps.unshift({ type: 'USE_ACCOUNT', account_id: device.account_id });
  }

  let successCount = 0;
  let failed = false;
  const logs = [];

  for (let i = 0; i < steps.length && !failed; i++) {
    const step = steps[i];
    try {
      // Inyectar lógica de negocio (accounts, settings)
      if (step.type === 'USE_ACCOUNT' || step.type === 'ROTATE_ACCOUNT') {
        const accounts = require('./accounts');
        if (step.type === 'USE_ACCOUNT') {
          accounts.assign(step.account_id, device.id);
        } else {
          accounts.rotate(device.id, platform);
        }
      }

      // Ejecutar paso vía router
      const result = await require('./logic').routerDispatch(
        device.serial_number || device.adb_serial,
        step.type,
        Object.fromEntries(Object.entries(step).filter(([k]) => k !== 'type'))
      );

      logs.push({ type: step.type, success: !!result.success, message: result.message });
      if (result.success) {
        successCount++;
      } else {
        // En views, un solo paso fallido no detiene todo (a diferencia de workflows)
        console.log(`[views] Paso ${step.type} falló en ${device.serial_number}: ${result.message}`);
      }

      // Pausa "humana" entre pasos (excepto tras el último)
      if (i < steps.length - 1) {
        const settings = require('./settings');
        const delay = settings.interStepDelayMs();
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
      }

    } catch (e) {
      logs.push({ type: step.type, success: false, message: e.message });
      console.error(`[views] Error ejecutando ${step.type} en ${device.serial_number}:`, e.message);
    }
  }

  return {
    platform,
    pattern: pattern.pattern,
    total_steps: steps.length,
    successful_steps: successCount,
    failed_steps: steps.length - successCount,
    logs,
    success: successCount > 0 // al menos un paso exitoso = view parcial
  };
}

// ---- Campañas de views ----
/**
 * Crea una campaña de views.
 */
function createCampaign({ name, platform, device_ids, group_id, config, mode = 'one_shot' }) {
  const now_ts = now();
  const campaignId = 'vc-' + crypto.randomUUID().slice(0, 8);

  // Validar plataforma
  if (!PATTERN_MAP[platform]) throw new Error(`Plataforma no soportada: ${platform}`);

  // Seleccionar dispositivos
  let devices;
  if (device_ids && device_ids.length) {
    const placeholders = device_ids.map(() => '?').join(',');
    devices = DB.all(`SELECT * FROM devices WHERE id IN (${placeholders}) AND status != 'offline'`, [...device_ids]);
  } else if (group_id) {
    devices = DB.all(`SELECT d.* FROM devices d JOIN device_groups g ON d.assigned_group_id = g.id WHERE g.id = ? AND d.status != 'offline'`, [group_id]);
  }

  if (!devices || !devices.length) throw new Error('No hay dispositivos disponibles para la campaña');

  // Crear registro de campaña
  const r = DB.run(
    `INSERT INTO view_campaigns(id, name, platform, device_count, config, status, mode, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    [campaignId, name, platform, devices.length, JSON.stringify(config || {}), 'scheduled', mode, now_ts, now_ts]
  );

  // Crear sesiones para cada dispositivo
  const sessionIds = [];
  for (const d of devices) {
    const sessionId = crypto.randomUUID();
    DB.run(
      `INSERT INTO view_sessions(id, campaign_id, device_serial, platform, status, started_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      [sessionId, campaignId, d.serial_number, platform, 'scheduled', now_ts, now_ts, now_ts]
    );
    sessionIds.push(sessionId);

  }

  return { campaign: { id: campaignId, name, platform, device_count: devices.length, config }, sessions: sessionIds };
}

/**
 * Ejecuta una campaña en todos sus dispositivos (paralelo).
 */
async function runCampaign(campaignId) {
  const campaign = DB.get(`SELECT * FROM view_campaigns WHERE id = ?`, [campaignId]);
  if (!campaign) throw new Error('Campaña no encontrada');

  const config = JSON.parse(campaign.config || '{}');
  const sessions = DB.all(`SELECT s.*, d.serial_number, d.adb_serial, d.id as device_id FROM view_sessions s JOIN devices d ON s.device_serial = d.serial_number WHERE s.campaign_id = ?`, [campaignId]);

  // Actualizar estado de campaña a running
  DB.run(`UPDATE view_campaigns SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), campaignId]);

  // Actualizar sesiones a running
  for (const s of sessions) {
    DB.run(`UPDATE view_sessions SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), s.id]);
    DB.run(`UPDATE devices SET status = 'busy', current_task_id = ? WHERE id = ?`, [s.id, s.device_id]);
  }

  // Ejecutar en paralelo cada dispositivo
  const results = await Promise.all(sessions.map(async (session) => {
    const device = {
      serial_number: session.serial_number,
      adb_serial: session.adb_serial,
      id: session.device_id,
      account_id: null, // Se puede cargar desde accounts si se asignó
    };

    try {
      const result = await executeViewPattern(device, campaign.platform, config);

      // Actualizar sesión con métricas
      DB.run(
        `UPDATE view_sessions SET status = ?, completed_at = ?, updated_at = ?, view_count = ?, successful_steps = ?, failed_steps = ?, logs = ? WHERE id = ?`,
        [result.success ? 'completed' : 'failed', now(), now(), 1, result.successful_steps, result.failed_steps, JSON.stringify(result.logs), session.id]
      );

      return { sessionId: session.id, success: result.success };
    } catch (e) {
      DB.run(
        `UPDATE view_sessions SET status = ?, completed_at = ?, updated_at = ?, error_message = ? WHERE id = ?`,
        ['failed', now(), now(), e.message.slice(0, 500), session.id]
      );
      return { sessionId: session.id, success: false, error: e.message };
    } finally {
      // Liberar dispositivo
      DB.run(`UPDATE devices SET status = 'online', current_task_id = NULL WHERE id = ?`, [device.id]);
    }
  }));

  const completed = results.filter(r => r.success).length;
  const failed = results.length - completed;

  // Actualizar campaña a completada/failed
  DB.run(
    `UPDATE view_campaigns SET status = ?, completed_at = ?, updated_at = ?, views_delivered = ?, views_failed = ? WHERE id = ?`,
    [failed === results.length ? 'failed' : 'completed', now(), now(), completed, failed, campaignId]
  );

  return { campaign_id: campaignId, total: results.length, delivered: completed, failed };
}

/**
 * Ejecuta una campaña de forma asíncrona (no bloqueante).
 */
function runCampaignAsync(campaignId) {
  runCampaign(campaignId).catch(e => console.error(`[views] Campaña ${campaignId} falló:`, e.message));
}

// ---- Métricas y reportes ----
/**
 * Obtiene métricas de una campaña.
 */
function getCampaignStats(campaignId) {
  const campaign = DB.get(`SELECT * FROM view_campaigns WHERE id = ?`, [campaignId]);
  if (!campaign) return null;

  const sessions = DB.all(`SELECT * FROM view_sessions WHERE campaign_id = ? ORDER BY created_at DESC`, [campaignId]);
  const completed = sessions.filter(s => s.status === 'completed').length;
  const failed = sessions.filter(s => s.status === 'failed').length;

  // Métricas agregadas por plataforma (últimos 7 días)
  const platformStats = DB.all(
    `SELECT platform, COUNT(*) as total_sessions, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed FROM view_sessions WHERE created_at >= ? GROUP BY platform`,
    [new Date(Date.now() - 7 * 86400000).toISOString()]
  );

  return {
    campaign: { ...campaign, sessions_count: sessions.length },
    delivery_rate: sessions.length > 0 ? Number(((completed / sessions.length) * 100).toFixed(2)) : 0,
    completed_sessions: completed,
    failed_sessions: failed,
    platform_stats: platformStats || []
  };
}

/**
 * Obtiene dashboard de views (resumen general).
 */
function getViewsDashboard() {
  const totalCampaigns = DB.get(`SELECT COUNT(*) as c FROM view_campaigns`).c;
  const activeCampaigns = DB.get(`SELECT COUNT(*) as c FROM view_campaigns WHERE status IN ('scheduled','running')`).c;

  const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
  const viewsDelivered = DB.all(
    `SELECT platform, COUNT(*) as count FROM view_sessions WHERE created_at >= ? AND status='completed' GROUP BY platform`,
    [oneDayAgo]
  );

  const totalViews = DB.get(`SELECT SUM(view_count) as c FROM view_sessions`).c || 0;
  const successRate = DB.all(
    `SELECT COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed FROM view_sessions`
  );

  // Top dispositivos por views entregados
  const topDevices = DB.all(
    `SELECT d.serial_number, d.name, COUNT(vs.id) as views_delivered FROM devices d JOIN view_sessions vs ON vs.device_serial = d.serial_number WHERE vs.status='completed' GROUP BY d.id ORDER BY views_delivered DESC LIMIT 10`
  );

  return {
    total_campaigns: totalCampaigns || 0,
    active_campaigns: activeCampaigns || 0,
    total_views_generated: totalViews,
    success_rate: successRate && successRate[0] ? Number(((successRate[0].completed / (successRate[0].total || 1)) * 100).toFixed(2)) : 0,
    views_by_platform: viewsDelivered || [],
    top_devices: topDevices || []
  };
}

// ---- Scheduling de campañas automáticas ----
/**
 * Verifica schedules de views y dispara campañas si corresponde.
 */
function checkViewSchedules() {
  const d = new Date();
  const cur = d.toTimeString().slice(0, 5);
  const dow = d.getDay();

  // Buscar view_campaigns con modo 'recurring' que deban dispararse
  const recurring = DB.all(`SELECT * FROM view_campaigns WHERE status='scheduled' AND mode IN ('continuous','burst')`);

  for (const camp of recurring) {
    try {
      const config = JSON.parse(camp.config || '{}');
      if (config.mode === 'continuous') {
        // Verificar cooldown desde última ejecución
        const lastRun = DB.get(`SELECT MAX(completed_at) as last_run FROM view_sessions WHERE campaign_id = ?`, [camp.id]);
        const cooldownMs = (config.cooldown_seconds || 3600) * 1000;
        if (lastRun && lastRun.last_run) {
          const elapsed = Date.now() - new Date(lastRun.last_run).getTime();
          if (elapsed < cooldownMs) continue; // Aún en cooldown
        }

        // Disparar campaña
        runCampaignAsync(camp.id);
      } else if (config.mode === 'burst') {
        // Burst: ejecutar N veces con gap
        const burstCount = config.burst_count || 1;
        const lastBursts = DB.all(`SELECT COUNT(*) as c FROM view_sessions WHERE campaign_id = ?`, [camp.id]);
        if ((lastBursts[0]?.c || 0) < burstCount) {
          runCampaignAsync(camp.id);
        }
      }
    } catch (e) {
      console.error(`[views] Error en schedule de campaña ${camp.id}:`, e.message);
    }
  }
}

module.exports = {
  init,
  generateViewSteps,
  executeViewPattern,
  createCampaign,
  runCampaign,
  runCampaignAsync,
  getCampaignStats,
  getViewsDashboard,
  checkViewSchedules,
  PATTERN_MAP: Object.keys(PATTERN_MAP), // Plataformas soportadas
};
