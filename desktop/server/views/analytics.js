// Módulo de métricas y análisis de impacto
// Fase 3: Tracking de Engagement y Métricas

const { now } = require('./db');

/**
 * Recupera métricas orgánicas de una URL después de la campaña.
 * Simula llamadas a APIs externas de cada plataforma.
 */
async function fetchOrganicMetrics(platform, contentUrl) {
    try {
        // En producción, aquí irían las llamadas reales a las APIs de TikTok, YT, IG, X
        // Por ahora, devolvemos métricas simuladas basadas en el éxito de la campaña.

        console.log(`[Analytics] Fetching organic metrics for ${platform}: ${contentUrl}`);

        // Simulamos una respuesta de API
        return {
            organic_views_1h: Math.floor(Math.random() * 100),
            organic_views_24h: Math.floor(Math.random() * 1000),
            organic_likes_24h: Math.floor(Math.random() * 50),
            organic_comments_24h: Math.floor(Math.random() * 10)
        };
    } catch (e) {
        console.error(`[Analytics] Error fetching metrics for ${platform}:`, e);
        return { organic_views_1h: 0, organic_views_24h: 0, organic_likes_24h: 0, organic_comments_24h: 0 };
    }
}

/**
 * Calcula el ROI basado en las métricas y el objetivo de la campaña
 */
function calculateROI(metrics, targetViews) {
    if (!targetViews || targetViews <= 0) return 0;
    const completion = (metrics.organic_views_24h / targetViews) * 100;
    return completion.toFixed(2);
}

/**
 * Agregador de métricas para el dashboard
 */
async function getCampaignAnalytics() {
    // Obtener todas las campañas que no estén en draft
    const campaigns = db.all(`SELECT * FROM view_campaigns WHERE status != 'draft'`);
    const analytics = [];

    for (const campaign of campaigns) {
        const contentUrls = typeof campaign.content_urls === 'string' ? JSON.parse(campaign.content_urls) : [];
        if (contentUrls.length === 0) continue;

        const url = contentUrls[0];
        const metrics = await fetchOrganicMetrics(campaign.platform, url);

        analytics.push({
            ...campaign,
            organic_metrics: metrics,
            roi: calculateROI(metrics, campaign.target_view_count)
        });
    }

    return analytics;
}

module.exports = {
    fetchOrganicMetrics,
    getCampaignAnalytics,
    calculateROI
};
