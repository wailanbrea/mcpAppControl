const { open, now } = require('../db');
const { executeSteps } = require('../logic'); // Asegúrate de que logic.js exporte esto
const settings = require('./settings'); // Importar configuración de humanización

/**
 * Módulo de ejecución de vistas multi-plataforma
 * Maneja los patrones de comportamiento humano para cada red social.
 */

const PLATFORM_CONFIG = {
    tiktok: {
        package_name: 'com.zhiliaoapp.musically',
        min_duration: 15,
        max_duration: 45
    },
    youtube: {
        package_name: 'com.google.android.youtube',
        min_duration: 60,
        max_duration: 300
    },
    instagram: {
        package_name: 'com.instagram.android',
        min_duration: 15,
        max_duration: 40
    },
    twitter: {
        package_name: 'com.twitter.android',
        min_duration: 10,
        max_duration: 30
    }
};

/**
 * Ejecuta una sesión de vista basada en la plataforma seleccionada.
 */
async function executeViewSession(db, deviceSerial, account, contentUrl, platform) {
    const config = PLATFORM_CONFIG[platform.toLowerCase()];
    if (!config) throw new Error(`Plataforma ${platform} no soportada.`);

    // 1. Registrar inicio de sesión
    db.run(`UPDATE view_sessions SET status = 'running', started_at = ? WHERE id = ?`, [now(), contentUrl]); // Nota: Usamos contentUrl como ID temporal si no hay ID real

    // 2. Abrir Aplicación
    const steps = [
        { type: 'OPEN_APP', packageName: config.package_name },
        { type: 'WAIT', duration: 5000 },
        { type: 'GOTO_URL', url: contentUrl }
    ];

    // 3. Ejecutar patrón según plataforma
    switch (platform.toLowerCase()) {
        case 'tiktok':
            steps.push(...generateTikTokPattern(deviceSerial, 20000)); // 20s de scroll base
            break;
        case 'youtube':
            steps.push(...generateYouTubePattern(deviceSerial, 120000)); // 2min de watch base
            break;
        case 'instagram':
            steps.push(...generateInstagramPattern(deviceSerial, 15000));
            break;
        case 'twitter':
            steps.push(...generateTwitterPattern(deviceSerial, 15000));
            break;
    }

    try {
        const result = await executeSteps(db, deviceSerial, steps);

        if (result.success) {
            db.run(`UPDATE view_sessions SET status = 'completed', completed_at = ? WHERE id = ?`, [now(), contentUrl]);
        } else {
            db.run(`UPDATE view_sessions SET status = 'failed', error_message = ? WHERE id = ?`, [result.error, contentUrl]);
        }
        return result;
    } catch (error) {
        db.run(`UPDATE view_sessions SET status = 'failed', error_message = ? WHERE id = ?`, [error.message, contentUrl]);
        throw error;
    }
}

/**
 * Genera secuencia de scrolls para TikTok con variaciones humanas.
 */
function generateTikTokPattern(serial, durationMs) {
    const steps = [];
    const scrollCount = Math.floor(durationMs / 12000);
    for (let i = 0; i < scrollCount; i++) {
        steps.push({ type: 'SCROLL', direction: 'down' });
        // Humanización: delay variable entre 2 y 5 segundos
        const delay = 2000 + Math.random() * 3000;
        steps.push({ type: 'WAIT', duration: delay });

        // Probabilidad de Like (20%)
        if (Math.random() < 0.2) {
            steps.push({ type: 'CLICK_BY_TEXT', text: 'Me gusta' });
        }
    }
    return steps;
}

/**
 * Genera secuencia de visualización para YouTube (Watch + Loop).
 */
function generateYouTubePattern(serial, durationMs) {
    const steps = [];
    const watchMinutes = Math.floor(durationMs / 60000);
    for (let i = 0; i < watchMinutes; i++) {
        steps.push({ type: 'WAIT', duration: 60000 }); // Espera 1 min

        // Interacción aleatoria en comentarios (15%)
        if (Math.random() < 0.15) {
            steps.push({ type: 'CLICK_BY_TEXT', text: 'Comentarios' });
            steps.push({ type: 'SCROLL', direction: 'down' });
            steps.push({ type: 'PRESS_BACK' });
        }

        // Like ocasional (10%)
        if (Math.random() < 0.1) {
            steps.push({ type: 'CLICK_BY_TEXT', text: 'Me gusta' });
        }
    }
    return steps;
}

/**
 * Genera secuencia para Instagram Reels.
 */
function generateInstagramPattern(serial, durationMs) {
    const steps = [];
    const reelCount = Math.floor(durationMs / 10000);
    for (let i = 0; i < reelCount; i++) {
        steps.push({ type: 'SCROLL', direction: 'down' });
        steps.push({ type: 'WAIT', duration: 3000 + Math.random() * 2000 });

        // Doble tap para like (Instagram)
        if (Math.random() < 0.15) {
            steps.push({ type: 'CLICK', x: 500, y: 500 }); // Clic en el centro del reel
        }
    }
    return steps;
}

/**
 * Genera secuencia para X (Twitter).
 */
function generateTwitterPattern(serial, durationMs) {
    const steps = [];
    const scrollCount = Math.floor(durationMs / 8000);
    for (let i = 0; i < scrollCount; i++) {
        steps.push({ type: 'SCROLL', direction: 'down' });
        steps.push({ type: 'WAIT', duration: 2000 + Math.random() * 2000 });

        if (Math.random() < 0.1) {
            steps.push({ type: 'CLICK_BY_TEXT', text: 'Retuit' });
        }
    }
    return steps;
}

module.exports = {
    executeViewSession,
    generateTikTokPattern,
    generateYouTubePattern,
    generateInstagramPattern,
    generateTwitterPattern
};
