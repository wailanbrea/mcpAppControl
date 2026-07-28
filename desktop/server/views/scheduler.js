// Planificador de campañas de views y distribución de carga
// Fase 2: Scheduling Avanzado

const { now } = require('./db');

class ViewScheduler {
    constructor(db) {
        this.db = db;
    }

    /**
     * Escanea campañas activas y programa nuevas sesiones de vista según la tasa definida.
     * Se debe llamar periódicamente (ej. cada 60 segundos).
     */
    async tick() {
        try {
            // 1. Buscar campañas activas que tengan tiempo de ejecución
            const activeCampaigns = this.db.all(
                `SELECT * FROM view_campaigns WHERE status = 'active' AND (end_time IS NULL OR end_time > ?)`,
                [now()]
            );

            for (const campaign of activeCampaigns) {
                const config = JSON.parse(campaign.config || '{}');
                const viewsThisHour = this.countViewsThisHour(campaign.id);

                // Si la tasa actual es menor que la meta por hora, programamos más
                if (viewsThisHour < (config.views_per_hour || 10)) {
                    await this.scheduleNextView(campaign, config);
                }
            }
        } catch (e) {
            console.error('[ViewScheduler] Error en tick():', e);
        }
    }

    /**
     * Cuenta las vistas completadas en la última hora para esta campaña
     */
    countViewsThisHour(campaignId) {
        const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
        const result = this.db.all(
            `SELECT COUNT(*) as c FROM view_sessions
             WHERE campaign_id = ? AND status = 'completed' AND completed_at >= ?`,
            [campaignId, oneHourAgo]
        );
        return result[0] ? result[0].c : 0;
    }

    /**
     * Selecciona recursos (URL, Cuenta, Dispositivo) y crea una nueva sesión
     */
    async scheduleNextView(campaign, config) {
        // 1. Seleccionar URL (rotación circular simple)
        const urls = typeof campaign.content_urls === 'string' ? JSON.parse(campaign.content_urls) : [];
        if (!urls || urls.length === 0) return;

        // Seleccionamos una URL basada en el ID de la campaña para consistencia simple
        const urlIndex = campaign.id.length % urls.length;
        const selectedUrl = urls[urlIndex];

        // 2. Seleccionar Cuenta disponible (Cooldown check)
        const account = await this.getAvailableAccount(campaign.accounts_ids);
        if (!account) return;

        // 3. Seleccionar Dispositivo libre del grupo
        const device = await this.getFreeDevice(campaign.device_group_id);
        if (!device) return;

        // 4. Insertar en la base de datos
        this.db.run(
            `INSERT INTO view_sessions(id, campaign_id, device_serial, platform, content_url,
             view_type, duration_seconds, status, started_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'organic', ?, 'scheduled', ?, ?, ?)`,
            [
                `sess-${Math.random().toString(36).substr(2, 9)}`,
                campaign.id,
                device.serial_number,
                campaign.platform,
                selectedUrl,
                config.default_duration_seconds || 30,
                now(),
                now(),
                now()
            ]
        );

        // 5. Disparar ejecución (Inyectar en el router de lógica)
        // Usamos la lógica de dispatch de logic.js para iniciar inmediatamente
        const logic = require('./logic');
        logic.dispatchViewSession(device.serial_number, account, selectedUrl, campaign.platform);
    }

    async getAvailableAccount(accountIdsStr) {
        if (!accountIdsStr) return null;
        const ids = JSON.parse(accountIdsStr);

        const result = this.db.all(
            `SELECT * FROM accounts
             WHERE id IN (?)
             AND active = 1
             AND (cooldown_until IS NULL OR cooldown_until < ?)
             ORDER BY last_used_at ASC
             LIMIT 1`,
            [ids, now()]
        );
        return result.length > 0 ? result[0] : null;
    }

    async getFreeDevice(groupId) {
        if (!groupId) return null;

        const result = this.db.all(
            `SELECT * FROM devices
             WHERE assigned_group_id = ?
             AND status = 'online'
             AND current_task_id IS NULL
             LIMIT 1`,
            [groupId]
        );
        return result.length > 0 ? result[0] : null;
    }
}

module.exports = ViewScheduler;
