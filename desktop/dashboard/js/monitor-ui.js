// ============================================================
// MCP CONTROL BSOLUTIONS · NOTIFICACIONES + ALERTAS + ANTIBANEO (UI)
// Campana flotante con contador, panel de notificaciones, configuración de
// canales de alerta y acción para quitar la marca de un dispositivo.
// Módulo independiente; usa el global apiFetch de dashboard.js.
// ============================================================
(function () {
  'use strict';
  const esc = (t) => { const d = document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML; };
  const $ = (id) => document.getElementById(id);
  let unread = 0;

  function ensureBell() {
    if ($('mcpBell')) return;
    const bell = document.createElement('div');
    bell.id = 'mcpBell';
    bell.className = 'mcp-bell';
    bell.innerHTML = `
      <button class="mcp-bell-btn" onclick="mcpTogglePanel()" title="Notificaciones y alertas">
        🔔<span id="mcpBellCount" class="mcp-bell-count" hidden>0</span>
      </button>`;
    document.body.appendChild(bell);

    const panel = document.createElement('div');
    panel.id = 'mcpNotifPanel';
    panel.className = 'mcp-notif-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="mcp-notif-head">
        <strong>Notificaciones</strong>
        <div>
          <button class="mcp-mini" onclick="mcpOpenAlertConfig()" title="Configurar alertas">⚙️</button>
          <button class="mcp-mini" onclick="mcpMarkAll()" title="Marcar leídas">✓</button>
          <button class="mcp-mini" onclick="mcpClearNotifs()" title="Borrar todas">🗑️</button>
        </div>
      </div>
      <div id="mcpNotifList" class="mcp-notif-list"></div>`;
    document.body.appendChild(panel);
  }

  window.mcpTogglePanel = async () => {
    ensureBell();
    const p = $('mcpNotifPanel');
    p.hidden = !p.hidden;
    if (!p.hidden) await refresh();
  };

  async function refresh() {
    try {
      const r = await apiFetch('/notifications');
      const { notifications, unread: u } = r.data;
      unread = u; updateCount();
      const list = $('mcpNotifList');
      if (!list) return;
      if (!notifications.length) { list.innerHTML = '<p class="mcp-empty">Sin notificaciones.</p>'; return; }
      list.innerHTML = notifications.map(n => {
        const sev = (n.data && n.data.severity) || 'info';
        const time = (n.created_at || '').replace('T', ' ').slice(0, 16);
        return `<div class="mcp-notif ${n.read ? 'read' : ''} sev-${esc(sev)}">
          <div class="mcp-notif-msg">${esc(n.message)}</div>
          <div class="mcp-notif-time">${esc(time)}</div>
        </div>`;
      }).join('');
    } catch (e) { /* backend momentáneamente no disponible */ }
  }

  function updateCount() {
    const c = $('mcpBellCount'); if (!c) return;
    c.textContent = unread > 99 ? '99+' : String(unread);
    c.hidden = unread === 0;
    const btn = document.querySelector('.mcp-bell-btn');
    if (btn) btn.classList.toggle('has-unread', unread > 0);
  }

  window.mcpMarkAll = async () => { try { await apiFetch('/notifications/read-all', { method: 'POST', body: '{}' }); await refresh(); } catch (e) {} };
  window.mcpClearNotifs = async () => { if (!confirm('¿Borrar todas las notificaciones?')) return; try { await apiFetch('/notifications', { method: 'DELETE' }); await refresh(); } catch (e) {} };

  window.clearDeviceFlag = async (deviceId) => {
    try { await apiFetch('/devices/' + deviceId + '/clear-flag', { method: 'POST', body: '{}' }); if (typeof loadAll === 'function') loadAll(); }
    catch (e) { alert('Error: ' + e.message); }
  };

  // ---------- Configuración de alertas ----------
  window.mcpOpenAlertConfig = async () => {
    let cfg = {}, st = {};
    try { cfg = (await apiFetch('/alerts/config')).data; } catch (e) {}
    try { st = (await apiFetch('/settings')).data; } catch (e) {}
    $('mcpAlertModal')?.remove();
    const ov = document.createElement('div');
    ov.id = 'mcpAlertModal';
    ov.className = 'mcp-modal-overlay';
    ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
    ov.innerHTML = `
      <div class="mcp-modal">
        <h3>⚙️ Alertas y monitor antibaneo</h3>
        <p class="mcp-sub">Detecta baneo, captcha, verificación o límite de tasa leyendo la pantalla, y te avisa.</p>
        <label class="mcp-check"><input id="acEnabled" type="checkbox" ${cfg.enabled ? 'checked' : ''}> Enviar alertas a canales externos</label>
        <label>Webhook URL (opcional)
          <input id="acWebhook" type="text" value="${esc(cfg.webhook_url || '')}" placeholder="https://...">
        </label>
        <div class="mcp-row">
          <label class="mcp-half">Token bot Telegram ${cfg.telegram_token_set ? '<span class="mcp-ok">✓ guardado</span>' : ''}
            <input id="acTgToken" type="password" placeholder="${cfg.telegram_token_set ? '•••• (dejar vacío = mantener)' : '123:ABC...'}">
          </label>
          <label class="mcp-half">Chat ID Telegram
            <input id="acTgChat" type="text" value="${esc(cfg.telegram_chat_id || '')}" placeholder="-100123...">
          </label>
        </div>
        <hr>
        <label class="mcp-check"><input id="acMonitor" type="checkbox" ${cfg.monitor_enabled ? 'checked' : ''}> Monitor automático (revisa pantallas periódicamente)</label>
        <div class="mcp-row">
          <label class="mcp-half">Intervalo (segundos)
            <input id="acInterval" type="number" min="30" value="${esc(cfg.monitor_interval_sec || 120)}">
          </label>
          <label class="mcp-half mcp-check2"><input id="acAutoPause" type="checkbox" ${cfg.auto_pause_on_flag ? 'checked' : ''}> Pausar dispositivo al detectar</label>
        </div>
        <hr>
        <label class="mcp-check"><input id="stHumanize" type="checkbox" ${st.humanize_enabled ? 'checked' : ''}> Comportamiento humano (pausas y gestos aleatorios)</label>
        <div class="mcp-row">
          <label class="mcp-half">Pausa mín. entre pasos (ms)<input id="stJmin" type="number" value="${esc(st.jitter_min_ms ?? 500)}"></label>
          <label class="mcp-half">Pausa máx. (ms)<input id="stJmax" type="number" value="${esc(st.jitter_max_ms ?? 2500)}"></label>
        </div>
        <div class="mcp-row">
          <label class="mcp-half">Jitter de toque (px)<input id="stTap" type="number" value="${esc(st.tap_jitter_px ?? 8)}"></label>
          <label class="mcp-half">Variación de swipe (0-1)<input id="stSwipe" type="number" step="0.05" value="${esc(st.swipe_variance ?? 0.35)}"></label>
        </div>
        <hr>
        <label class="mcp-check"><input id="stHw" type="checkbox" ${st.hw_enabled ? 'checked' : ''}> Monitor de hardware (batería/temp/almacenamiento)</label>
        <div class="mcp-row">
          <label class="mcp-half">Intervalo (s)<input id="stHwInt" type="number" value="${esc(st.hw_interval_sec ?? 300)}"></label>
          <label class="mcp-half">Batería mín. (%)<input id="stBat" type="number" value="${esc(st.battery_min ?? 20)}"></label>
        </div>
        <div class="mcp-row">
          <label class="mcp-half">Temp. máx. (°C)<input id="stTemp" type="number" value="${esc(st.temp_max_c ?? 45)}"></label>
          <label class="mcp-half">Almacenam. mín. (MB)<input id="stSto" type="number" value="${esc(st.storage_min_mb ?? 500)}"></label>
        </div>
        <div id="acMsg" class="mcp-msg"></div>
        <div class="mcp-modal-actions">
          <button class="rt-btn" onclick="mcpTestAlert()">Enviar alerta de prueba</button>
          <button class="rt-btn primary" onclick="mcpSaveAlertConfig()">💾 Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
  };

  window.mcpSaveAlertConfig = async () => {
    const body = {
      enabled: $('acEnabled').checked,
      webhook_url: $('acWebhook').value.trim(),
      telegram_chat_id: $('acTgChat').value.trim(),
      monitor_enabled: $('acMonitor').checked,
      monitor_interval_sec: Number($('acInterval').value) || 120,
      auto_pause_on_flag: $('acAutoPause').checked,
    };
    const tok = $('acTgToken').value.trim();
    if (tok) body.telegram_token = tok; // vacío = mantener el actual
    const stBody = {
      humanize_enabled: $('stHumanize').checked,
      jitter_min_ms: Number($('stJmin').value) || 0, jitter_max_ms: Number($('stJmax').value) || 0,
      tap_jitter_px: Number($('stTap').value) || 0, swipe_variance: Number($('stSwipe').value) || 0,
      hw_enabled: $('stHw').checked, hw_interval_sec: Number($('stHwInt').value) || 300,
      battery_min: Number($('stBat').value) || 0, temp_max_c: Number($('stTemp').value) || 0, storage_min_mb: Number($('stSto').value) || 0,
    };
    try {
      await apiFetch('/alerts/config', { method: 'PUT', body: JSON.stringify(body) });
      await apiFetch('/settings', { method: 'PUT', body: JSON.stringify(stBody) });
      const m = $('acMsg'); m.textContent = '✔ Guardado.'; m.className = 'mcp-msg ok';
    } catch (e) { const m = $('acMsg'); m.textContent = 'Error: ' + e.message; m.className = 'mcp-msg err'; }
  };

  window.mcpTestAlert = async () => {
    try { await apiFetch('/alerts/test', { method: 'POST', body: '{}' }); const m = $('acMsg'); m.textContent = '✔ Alerta de prueba enviada.'; m.className = 'mcp-msg ok'; await refresh(); }
    catch (e) { const m = $('acMsg'); m.textContent = 'Error: ' + e.message; m.className = 'mcp-msg err'; }
  };

  // ---------- Init: campana + sondeo + push por WebSocket ----------
  document.addEventListener('DOMContentLoaded', () => {
    ensureBell();
    refresh();
    setInterval(refresh, 15000);
    // engancha a los eventos WS de dashboard.js si están disponibles
    try {
      const orig = window.wsConnection;
      // refresco al recibir eventos: escuchamos mediante un temporizador ligero + evento global
    } catch (e) {}
  });

  // Permite que dashboard.js dispare un refresco al recibir 'notification' por WS.
  window.mcpOnNotification = () => refresh();
})();
