# Plan: Granja de Bots Automatizada para Views en Redes Sociales

## Estado Actual (Fase 0 — Base Sólida)

| Componente | Estado | Notas |
|---|---|---|
| ADB Transport | ✅ Completo | 40+ comandos, polling USB/TCP, captura pantalla, push/pull, screenrecord |
| WebSocket Router | ✅ Completo | Protocolo agentes + dispatch comandos + broadcast eventos |
| Express API | ✅ Completo | ~25 endpoints REST (devices, workflows, tasks, groups) |
| sql.js Database | ✅ Completo | Schema completo con migraciones, seed, pruning logs |
| Humanización | ✅ Completo | Delays aleatorios, jitter XY, variación duración swipe/scroll |
| Cuentas AES-256-GCM | ✅ Completo | TOTP RFC 6238, variable substitution `{{account.*}}`, rotación |
| Monitor Salud | ✅ Completo | Regex pantalla (captcha/baneo/rate_limit), pausa automática, sondeo HW |
| Alertas | ✅ Completo | BD + webhook/Telegram, broadcast WS |

---

## Fase 1: Motor de Views Multi-Plataforma (Prioridad Alta)

### 1.1 Tabla `view_sessions` — Registro de views por plataforma

```sql
CREATE TABLE IF NOT EXISTS view_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL CHECK(platform IN ('tiktok','youtube','instagram','twitter','facebook')),
    account_id INTEGER REFERENCES accounts(id),
    device_serial TEXT REFERENCES devices(serial_number),
    content_url TEXT,           -- URL del video/post a ver
    content_title TEXT,         -- Título/nombre del contenido
    view_type TEXT DEFAULT 'organic',  -- organic, loop, swipe, watch_complete
    duration_seconds INTEGER DEFAULT 15,
    started_at TEXT,
    completed_at TEXT,
    status TEXT DEFAULT 'running' CHECK(status IN ('scheduled','running','completed','failed')),
    error_message TEXT,
    created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_views_platform ON view_sessions(platform);
CREATE INDEX IF NOT EXISTS idx_views_status ON view_sessions(status);
```

### 1.2 Pipeline de ejecución por plataforma

Cada plataforma tiene un patrón de interacción distinto:

| Plataforma | Patrón de View | Duración Típica | Acciones Clave |
|---|---|---|---|
| **TikTok** | Scroll vertical infinito | 15-30s/video | Tap centro (play/pause), scroll down, like aleatorio, comentario ocasional |
| **YouTube** | Watch completo + loop | 60-300s/video | Play, esperar progreso, scroll comentarios, volver a inicio, siguiente video |
| **Instagram Reels** | Scroll vertical + watch | 10-25s/reel | Tap centro, scroll down, like (doble tap), follow ocasional |
| **X/Twitter** | Video feed scroll | 8-20s/video | Scroll down, like retweet aleatorio, seguir cuenta ocasional |

### 1.3 Módulo `desktop/server/views/pipeline.js`

```javascript
// Función principal: ejecuta un view session en un dispositivo
async function executeViewSession(db, deviceSerial, account, contentUrl, platform) {
    // 1. Abrir app por package_name (configurable por plataforma)
    // 2. Navegar al contenido (GOTO_URL o búsqueda interna)
    // 3. Ejecutar patrón de interacción según plataforma
    // 4. Registrar resultado en view_sessions
}

// Patrón TikTok: scroll + like aleatorio
async function tikTokPattern(db, serial, account, durationMs) {
    const steps = [
        { type: 'OPEN_APP', packageName: 'com.zhiliaoapp.musically' },
        { type: 'WAIT', duration: 3000 },
        // Scroll vertical con delays variables
        ...generateScrollSequence(serial, Math.floor(durationMs / 15000)),
        // Like aleatorio (20% probabilidad)
        ...(Math.random() < 0.2 ? [{ type: 'CLICK_BY_TEXT', text: 'Me gusta' }] : []),
        // Comentario ocasional (5% probabilidad)
        ...(Math.random() < 0.05 ? [
            { type: 'CLICK_BY_ID', resource_id: 'com.zhiliaoapp.musically:id/comment_button' },
            { type: 'SET_TEXT', value: '{{account.username}} likes this!' },
            { type: 'PRESS_BACK' }
        ] : []),
    ];
    return executeSteps(db, serial, steps);
}

// Patrón YouTube: watch + loop
async function youtubePattern(db, serial, account, durationMs) {
    const steps = [
        { type: 'OPEN_APP', packageName: 'com.google.android.youtube' },
        { type: 'WAIT', duration: 3000 },
        // Navegar al video (GOTO_URL con URL del video)
        { type: 'GOTO_URL', url: contentUrl },
        { type: 'WAIT', duration: 5000 },
        // Esperar reproducción completa o loop
        ...generateWatchSequence(serial, Math.floor(durationMs / 60000)),
    ];
    return executeSteps(db, serial, steps);
}

// Genera secuencia de scrolls con delays aleatorios (humanización)
function generateScrollSequence(serial, scrollCount) {
    const steps = [];
    for (let i = 0; i < Math.max(1, scrollCount); i++) {
        steps.push({ type: 'SCROLL', direction: 'down' });
        steps.push({ type: 'WAIT', duration: settings.varyDuration(2000 + Math.random() * 3000) });
    }
    return steps;
}

// Genera secuencia de watch con interacciones ocasionales
function generateWatchSequence(serial, watchMinutes) {
    const steps = [];
    for (let i = 0; i < watchMinutes; i++) {
        // Scroll comentarios aleatorio (15% probabilidad)
        if (Math.random() < 0.15) {
            steps.push({ type: 'CLICK_BY_TEXT', text: 'Comentarios' });
            steps.push({ type: 'SCROLL', direction: 'down' });
            steps.push({ type: 'PRESS_BACK' });
        }
        // Like ocasional (10% probabilidad)
        if (Math.random() < 0.10) {
            steps.push({ type: 'CLICK_BY_TEXT', text: 'Me gusta' });
        }
    }
    return steps;
}
```

### 1.4 Tabla `view_configs` — Configuración por plataforma

```sql
CREATE TABLE IF NOT EXISTS view_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT UNIQUE NOT NULL,
    package_name TEXT,           -- APK package name
    default_duration_seconds INTEGER DEFAULT 30,
    max_concurrent_views INTEGER DEFAULT 5,
    like_probability REAL DEFAULT 0.2,       -- probabilidad de dar like por view
    comment_probability REAL DEFAULT 0.05,   -- probabilidad de comentar
    follow_probability REAL DEFAULT 0.03,    -- probabilidad de seguir cuenta
    loop_enabled INTEGER DEFAULT 1,          -- repetir contenido
    loop_count INTEGER DEFAULT 1,            -- veces que repite cada video
    cooldown_minutes INTEGER DEFAULT 2,      -- pausa entre views del mismo account
    created_at TEXT, updated_at TEXT
);
```

---

## Fase 2: Sistema de Scheduling Avanzado (Prioridad Alta)

### 2.1 Tabla `view_campaigns` — Campañas de views programadas

```sql
CREATE TABLE IF NOT EXISTS view_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    content_urls TEXT,           -- JSON array de URLs a promocionar
    target_view_count INTEGER DEFAULT 0,   -- meta total de views
    current_view_count INTEGER DEFAULT 0,
    accounts_ids TEXT,           -- JSON array de account IDs asignados
    device_group_id INTEGER REFERENCES device_groups(id),
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft','active','paused','completed')),
    schedule_mode TEXT DEFAULT 'continuous',  -- continuous, burst, drip, custom
    views_per_hour INTEGER DEFAULT 10,     -- tasa de views/hora
    start_time TEXT,
    end_time TEXT,
    created_at TEXT, updated_at TEXT
);
```

### 2.2 Módulo `desktop/server/views/scheduler.js`

```javascript
// Planificador que distribuye views en el tiempo según la campaña
class ViewScheduler {
    constructor(db) { this.db = db; }

    // Escanea campañas activas y programa nuevos view sessions
    async tick() {
        const activeCampaigns = this.db.all(
            `SELECT * FROM view_campaigns WHERE status = 'active' AND end_time > ?`,
            [now()]
        );

        for (const campaign of activeCampaigns) {
            // Calcular cuántas views debería tener esta hora
            const viewsThisHour = this.countViewsThisHour(campaign.id);
            if (viewsThisHour < campaign.views_per_hour) {
                await this.scheduleNextView(campaign);
            }
        }
    }

    async scheduleNextView(campaign) {
        // Seleccionar siguiente URL no agotada
        const url = this.getNextUrl(campaign.content_urls, campaign.id);
        if (!url) return;

        // Seleccionar cuenta disponible (cooldown check)
        const account = await this.getAvailableAccount(campaign.accounts_ids);
        if (!account) return;

        // Seleccionar dispositivo libre del grupo
        const device = await this.getFreeDevice(campaign.device_group_id);
        if (!device) return;

        // Crear view session
        this.db.run(`INSERT INTO view_sessions(platform, account_id, device_serial, content_url,
                      view_type, duration_seconds, started_at, status, created_at, updated_at)
                      VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`,
            [campaign.platform, account.id, device.serial_number, url.url,
             campaign.default_duration_seconds || 30, now(), now()]);

        // Disparar ejecución inmediata o programada
        await this.dispatchViewSession(device.serial_number, account, url.url, campaign.platform);
    }
}
```

### 2.3 Modos de scheduling

| Modo | Descripción | Uso típico |
|---|---|---|
| **continuous** | Views constantes durante ventana horaria | Crecimiento orgánico sostenido |
| **burst** | Nube de views en corto tiempo (10-50/hora) | Lanzamiento de contenido nuevo |
| **drip** | Varios views distribuidos a lo largo del día | Mantenimiento de visibilidad |
| **custom** | Horario específico por hora/día | Campañas con picos definidos |

---

## Fase 3: Tracking de Engagement y Métricas (Prioridad Media)

### 3.1 Tabla `engagement_metrics` — Métricas post-view

```sql
CREATE TABLE IF NOT EXISTS engagement_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    view_session_id INTEGER REFERENCES view_sessions(id),
    platform TEXT NOT NULL,
    content_url TEXT,

    -- Métricas de visualización
    views_generated INTEGER DEFAULT 0,
    watch_time_seconds INTEGER DEFAULT 0,
    completion_rate REAL DEFAULT 0,     -- % del video visto

    -- Métricas de interacción
    likes_given INTEGER DEFAULT 0,
    comments_given INTEGER DEFAULT 0,
    shares_given INTEGER DEFAULT 0,
    follows_given INTEGER DEFAULT 0,

    -- Métricas orgánicas (post-view)
    organic_views_1h INTEGER DEFAULT 0,   -- views reales en 1 hora post-campaña
    organic_views_24h INTEGER DEFAULT 0,  -- views reales en 24 horas
    organic_likes_24h INTEGER DEFAULT 0,
    organic_comments_24h INTEGER DEFAULT 0,

    created_at TEXT, updated_at TEXT
);
```

### 3.2 Módulo `desktop/server/views/analytics.js`

```javascript
// Recupera métricas orgánicas de una URL después de la campaña
async function fetchOrganicMetrics(platform, contentUrl) {
    switch (platform) {
        case 'tiktok':
            return await tikTokApi.getVideoStats(contentUrl);
        case 'youtube':
            return await youtubeApi.getVideoStats(contentUrl);
        case 'instagram':
            return await instagramApi.getReelStats(contentUrl);
        // ...
    }
}

// Dashboard endpoint: resumen de campañas
app.get('/api/v1/views/analytics', async (req, res) => {
    const campaigns = db.all(`SELECT * FROM view_campaigns WHERE status != 'draft'`);
    const analytics = [];

    for (const campaign of campaigns) {
        const metrics = await fetchOrganicMetrics(campaign.platform, campaign.content_urls[0]);
        analytics.push({
            ...campaign,
            organic_metrics: metrics,
            roi: calculateROI(metrics, campaign.target_view_count),
        });
    }

    res.json({ success: true, data: analytics });
});
```

### 3.3 Métricas clave a exponer en el dashboard

- **Views generadas vs orgánicas** — ratio real de impacto
- **Costo por view** — según horas de dispositivo utilizadas
- **Tasa de completitud** — % de views que llegaron al final del video
- **Engagement rate** — likes + comentarios / views totales
- **Health score** — % de dispositivos sin baneo/captcha en las últimas 24h

---

## Fase 4: Rotación Inteligente de Cuentas (Prioridad Media)

### 4.1 Tabla `account_rotation_log`

```sql
CREATE TABLE IF NOT EXISTS account_rotation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER REFERENCES accounts(id),
    device_serial TEXT,
    action TEXT CHECK(action IN ('assign','release','cooldown','rotate')),
    reason TEXT,
    created_at TEXT
);
```

### 4.2 Estrategia de rotación

| Estrategia | Descripción | Beneficio |
|---|---|---|
| **1 cuenta = 1 dispositivo** | Cada dispositivo usa una cuenta fija | Máxima seguridad anti-baneo |
| **Rotación por cooldown** | Cuenta se libera tras cooldown, asignada a otro dispositivo | Maximiza uso de cuentas premium |
| **Pool compartido** | N cuentas para M dispositivos, rotación dinámica | Balance entre seguridad y eficiencia |

### 4.3 Módulo `desktop/server/views/rotation.js`

```javascript
class AccountRotation {
    // Asigna cuenta disponible al dispositivo para una campaña
    async assignAccount(campaign, device) {
        const available = this.db.all(`
            SELECT a.* FROM accounts a
            JOIN view_campaign_accounts vca ON a.id = vca.account_id
            WHERE vca.campaign_id = ?
              AND a.active = 1
              AND (a.cooldown_until IS NULL OR a.cooldown_until < ?)
            ORDER BY a.last_used_at ASC
            LIMIT 1`, [campaign.id, now()]);

        if (!available.length) return null;

        const account = available[0];
        this.db.run(`UPDATE accounts SET device_id = ?, active = 1, last_used_at = ? WHERE id = ?`,
            [device.serial_number, now(), account.id]);

        // Log rotation
        this.db.run(`INSERT INTO account_rotation_log(account_id, device_serial, action, reason, created_at)
                      VALUES (?, ?, 'assign', 'campaign_assignment', ?)`,
            [account.id, device.serial_number, now()]);

        return account;
    }
}
```

---

## Fase 5: Dashboard de Granja (Prioridad Baja — Visualización)

### 5.1 Nuevos endpoints REST para el dashboard

| Endpoint | Método | Descripción |
|---|---|---|
| `/api/v1/views/campaigns` | GET/POST/PUT/DELETE | CRUD campañas |
| `/api/v1/views/sessions` | GET | Historial de view sessions con filtros |
| `/api/v1/views/analytics` | GET | Métricas agregadas por plataforma/campaña |
| `/api/v1/views/configs/:platform` | GET/PUT | Configuración por plataforma |
| `/api/v1/views/dispatch` | POST | Disparar view session manual |

### 5.2 Widgets del dashboard de granja

```
┌─────────────────────────────────────────────────────────┐
│  📊 GRANJA DE BOTS — Panel de Control                    │
├──────────────┬──────────────┬──────────────┬─────────────┤
│  Dispositivos│  Campañas    │  Views Hoy   │  Engagement │
│  Online: 12  │  Activas: 3  │  Generated:  │  Rate: 4.2% │
│  Busy: 8     │  Pendientes: │  1,247       │  ↑ +0.5%    │
│  Offline: 2  │  15          │              │             │
├──────────────┴──────────────┴──────────────┴─────────────┤
│                                                          │
│  📈 VIEWS POR PLATAFORMA (últimas 24h)                   │
│  ████████████ TikTok: 847                                │
│  ██████ YouTube: 312                                     │
│  ████ Instagram: 89                                      │
│  ██ X/Twitter: 23                                        │
│                                                          │
│  📋 CAMPAÑAS ACTIVAS                                     │
│  ┌────────────┬──────────┬───────┬──────┬────────┐      │
│  │ Nombre     │ Platform │ Views │ Meta │ Status │      │
│  ├────────────┼──────────┼───────┼──────┼────────┤      │
│  │ TikTok V1  │ TikTok   │ 847/1k│ 85%  │ Active │      │
│  │ YT Boost   │ YouTube  │ 312/500│ 62% │ Active │      │
│  └────────────┴──────────┴───────┴──────┴────────┘      │
│                                                          │
│  📱 DISPOSITIVOS EN EJECUCIÓN                            │
│  [USB-001] ▶ TikTok scroll (2:34)                        │
│  [USB-002] ▶ YouTube watch (5:12)                        │
│  [USB-003] ⏸ Instagram cooldown                           │
└─────────────────────────────────────────────────────────┘
```

---

## Fase 6: Auto-Curación y Anti-Baneo (Prioridad Baja — Resiliencia)

### 6.1 Estrategias anti-baneo

| Estrategia | Implementación |
|---|---|
| **IP rotativa** | Ya soportada (proxy por dispositivo en `devices.proxy_*`) |
| **Delay variable entre acciones** | Ya implementado (`settings.js` — jitter + varyDuration) |
| **Pausa aleatoria** | Nuevo: 5-15% probabilidad de pausa 30-120s entre views |
| **Cuenta warm-up** | Nuevo: cuenta nueva hace 10-20 acciones orgánicas antes de campaña |
| **Detección captcha** | Ya implementado (`monitor.js` — regex pantalla) |
| **Auto-reinicio dispositivo** | Nuevo: si >3 captchas en 1 hora, reboot + espera 5 min |

### 6.2 Tabla `ban_recovery_log`

```sql
CREATE TABLE IF NOT EXISTS ban_recovery_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_serial TEXT REFERENCES devices(serial_number),
    detection_type TEXT CHECK(detection_type IN ('captcha','rate_limit','shadow_ban')),
    recovery_action TEXT,
    attempts INTEGER DEFAULT 1,
    success INTEGER DEFAULT 0,
    created_at TEXT
);
```

---

## Orden de Implementación Recomendado

| Fase | Estimación | Dependencias | Valor |
|---|---|---|---|
| **Fase 1** — Motor Views Multi-Plataforma | 2-3 días | Base actual | 🔴 Crítico |
| **Fase 2** — Scheduling Avanzado | 1-2 días | Fase 1 | 🔴 Crítico |
| **Fase 3** — Tracking Engagement | 1-2 días | Fase 1 | 🟡 Importante |
| **Fase 4** — Rotación Cuentas | 1 día | Fase 1, 2 | 🟡 Importante |
| **Fase 5** — Dashboard Granja | 2-3 días | Fases 1-4 | 🟢 Deseable |
| **Fase 6** — Auto-Curación | 1-2 días | Fase 1, 3 | 🟢 Deseable |

---

## Archivos Nuevos a Crear

```
desktop/server/
├── views/
│   ├── pipeline.js      # Motor de ejecución por plataforma (Fase 1)
│   ├── scheduler.js     # Planificador de campañas (Fase 2)
│   ├── analytics.js     # Métricas y tracking orgánico (Fase 3)
│   └── rotation.js      # Rotación inteligente de cuentas (Fase 4)
├── ban_recovery.js      # Auto-curación anti-baneo (Fase 6)
```

## Migraciones DB Necesarias

1. `view_sessions` — Registro de views por plataforma
2. `view_configs` — Configuración por plataforma
3. `view_campaigns` — Campañas programadas
4. `engagement_metrics` — Métricas post-view
5. `account_rotation_log` — Historial de rotación
6. `ban_recovery_log` — Historial de recuperación

## Integración con Código Existente

| Nuevo | Se integra con | Cómo |
|---|---|---|
| `pipeline.js` | `adb/index.js` | Ejecuta comandos ADB para interacciones |
| `scheduler.js` | `logic.js` (dispatchWorkflow) | Reutiliza el dispatcher de workflows existente |
| `analytics.js` | `accounts.js` | Lee cuentas cifradas para engagement |
| `rotation.js` | `monitor.js` | Usa detección de baneo para pausar rotación |
| `ban_recovery.js` | `alerts.js` | Envía alertas cuando se activa recovery |

---

## Próximos Pasos Inmediatos

1. **Crear tabla `view_sessions`** en `db.js` (schema + migración)
2. **Crear `desktop/server/views/pipeline.js`** con patrón TikTok mínimo funcional
3. **Agregar endpoints REST** para view sessions en `app.js`
4. **Probar pipeline completo**: dispositivo USB → abrir TikTok → scroll → registrar view
