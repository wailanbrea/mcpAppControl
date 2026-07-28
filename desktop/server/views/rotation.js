// Módulo de Rotación Inteligente de Cuentas (Fase 4)
// Gestiona la asignación dinámica de cuentas a dispositivos para maximizar el uso y seguridad.

const { now } = require('../db');

class AccountRotation {
    constructor(db) {
        this.db = db;
    }

    /**
     * Asigna una cuenta disponible para una campaña y un dispositivo específico.
     * Prioriza cuentas con menor tiempo de uso y que cumplan con el cooldown.
     */
    async assignAccount(campaignId, deviceSerial) {
        try {
            // 1. Buscar cuentas activas que pertenezcan a la campaña y cumplan cooldown
            // Filtramos por: activo = 1, cooldown_until < ahora, y que no tengan un dispositivo asignado activo (opcional pero recomendado)
            const available = this.db.all(`
                SELECT a.* FROM accounts a
                JOIN view_campaign_accounts vca ON a.id = vca.account_id
                WHERE vca.campaign_id = ?
                  AND a.active = 1
                  AND (a.cooldown_until IS NULL OR a.cooldown_until < ?)
                  AND (a.device_id IS NULL OR a.device_id = ?)
                ORDER BY a.last_used_at ASC
                LIMIT 1
            `, [campaignId, now(), deviceSerial]);

            if (!available.length) {
                return { success: false, message: 'No hay cuentas disponibles para esta campaña con cooldown cumplido.' };
            }

            const account = available[0];

            // 2. Asignar la cuenta al dispositivo
            const result = this.db.run(`
                UPDATE accounts
                SET device_id = ?,
                    active = 1,
                    last_used_at = ?
                WHERE id = ?
            `, [deviceSerial, now(), account.id]);

            // 3. Registrar la rotación
            this.db.run(`
                INSERT INTO account_rotation_log(account_id, device_serial, action, reason, created_at)
                VALUES (?, ?, 'assign', 'campaign_assignment', ?)
            `, [account.id, deviceSerial, now()]);

            return {
                success: true,
                data: account,
                message: 'Cuenta asignada correctamente'
            };
        } catch (e) {
            return { success: false, message: e.message };
        }
    }

    /**
     * Libera una cuenta cuando el dispositivo finaliza su tarea o falla.
     */
    async releaseAccount(accountId, deviceSerial) {
        try {
            // 1. Liberar el dispositivo de la cuenta
            this.db.run(`
                UPDATE accounts
                SET device_id = NULL,
                    active = 1,
                    last_used_at = ?
                WHERE id = ?
            `, [now(), accountId]);

            // 2. Registrar la liberación
            this.db.run(`
                INSERT INTO account_rotation_log(account_id, device_serial, action, reason, created_at)
                VALUES (?, ?, 'release', 'task_finished', ?)
            `, [accountId, deviceSerial, now()]);

            return { success: true };
        } catch (e) {
            return { success: false, message: e.message };
        }
    }

    /**
     * Aplica el cooldown a una cuenta tras una sesión exitosa.
     */
    async applyCooldown(accountId, minutes = 2) {
        try {
            const cooldown_seconds = minutes * 60;
            this.db.run(`
                UPDATE accounts
                SET cooldown_until = ?,
                    last_used_at = ?
                WHERE id = ?
            `, [now(new Date(Date.now() + cooldown_seconds * 1000)).toISOString(), now(), accountId]);

            this.db.run(`
                INSERT INTO account_rotation_log(account_id, device_serial, action, reason, created_at)
                VALUES (?, NULL, 'cooldown', 'post_session_cooldown', ?)
            `, [accountId, now()]);

            return { success: true };
        } catch (e) {
            return { success: false, message: e.message };
        }
    }
}

module.exports = new AccountRotation();
