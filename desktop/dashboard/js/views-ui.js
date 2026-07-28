// ============================================================
// MCP CONTROL BSOLUTIONS · CAMPAÑAS DE VIEWS (farmeo de visualizaciones)
// UI para el motor de views multi-plataforma (TikTok/YouTube/Instagram/X).
// Módulo aislado; usa apiFetch/extractList/selectedDeviceIds/devices/loadAll.
// ============================================================
(function () {
  'use strict';
  const esc = (t) => { const d = document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML; };
  const escA = (t) => esc(t).replace(/"/g, '&quot;');
  const $ = (id) => document.getElementById(id);

  const PLAT_LABEL = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram', twitter: 'X / Twitter' };
  const STATUS_LABEL = { scheduled: 'programada', running: 'en curso', completed: 'completada', failed: 'fallida', paused: 'pausada' };

  let campaigns = [], platforms = [], vGroups = [], selectedCampaignId = null;

  function ensureOverlay() {
    if ($('viewsOverlay')) return;
    const el = document.createElement('div');
    el.id = 'viewsOverlay';
    el.className = 'rt-overlay';
    el.hidden = true;
    el.innerHTML = `
      <div class="rt-modal">
        <div class="rt-head">
          <div class="rt-tabs"><button class="rt-tab active">📺 Campañas de Views</button></div>
          <button class="rt-close" onclick="vwClose()">✕</button>
        </div>
        <div id="vwStats" class="vw-stats"></div>
        <div class="rt-body">
          <div class="rt-pane">
            <div class="rt-col rt-list-col">
              <div class="rt-col-head"><span>Campañas</span><button class="rt-btn primary" onclick="vwNew()">+ Nueva</button></div>
              <div id="vwList" class="rt-list"></div>
            </div>
            <div class="rt-col rt-editor-col">
              <div id="vwEditor" class="rt-editor"></div>
            </div>
          </div>
        </div>
      </div>`;
    el.onclick = (e) => { if (e.target === el) vwClose(); };
    document.body.appendChild(el);
  }

  window.openViewsManager = async function () {
    ensureOverlay();
    $('viewsOverlay').hidden = false;
    await refresh();
    renderStats(); renderList(); renderEditor();
  };
  window.vwClose = () => { const o = $('viewsOverlay'); if (o) o.hidden = true; };

  async function refresh() {
    try { platforms = (await apiFetch('/views/platforms')).data || []; } catch (e) { platforms = [{ name: 'tiktok' }, { name: 'youtube' }, { name: 'instagram' }, { name: 'twitter' }]; }
    try { campaigns = extractList(await apiFetch('/views/campaigns?per_page=100')); } catch (e) { campaigns = []; }
    try { vGroups = extractList(await apiFetch('/groups')); } catch (e) { vGroups = []; }
  }

  function renderStats() {
    const box = $('vwStats'); if (!box) return;
    apiFetch('/views/dashboard').then(r => {
      const d = r.data || {};
      box.innerHTML = `
        <div class="vw-stat"><span class="vw-n">${d.total_campaigns ?? 0}</span><span class="vw-l">campañas</span></div>
        <div class="vw-stat"><span class="vw-n">${d.active_campaigns ?? 0}</span><span class="vw-l">activas</span></div>
        <div class="vw-stat"><span class="vw-n">${d.total_views_generated ?? 0}</span><span class="vw-l">views generadas</span></div>
        <div class="vw-stat"><span class="vw-n">${d.success_rate ?? 0}%</span><span class="vw-l">éxito</span></div>`;
    }).catch(() => { box.innerHTML = ''; });
  }

  function renderList() {
    const box = $('vwList'); if (!box) return;
    if (!campaigns.length) { box.innerHTML = '<p class="rt-empty">Sin campañas. Crea una nueva.</p>'; return; }
    box.innerHTML = campaigns.map(c => `
      <div class="rt-list-item ${selectedCampaignId === c.id ? 'active' : ''}" onclick="vwSelect('${c.id}')">
        <div class="rt-item-name">${esc(c.name)} <span class="vw-badge p-${esc(c.platform)}">${esc(PLAT_LABEL[c.platform] || c.platform)}</span></div>
        <div class="rt-item-sub">${esc(STATUS_LABEL[c.status] || c.status)} · ${c.device_count || 0} disp. · ${c.mode === 'one_shot' ? 'una vez' : 'continua'}</div>
      </div>`).join('');
  }

  window.vwNew = () => { selectedCampaignId = null; renderEditor(); renderList(); };
  window.vwSelect = (id) => { selectedCampaignId = id; renderEditor(campaigns.find(c => c.id === id)); renderList(); };

  function renderEditor(c) {
    const box = $('vwEditor'); if (!box) return;
    if (c) { renderCampaignDetail(c); return; }
    // Formulario de creación
    const selCount = (typeof selectedDeviceIds !== 'undefined') ? selectedDeviceIds.size : 0;
    const platOpts = platforms.map(p => `<option value="${p.name}">${esc(PLAT_LABEL[p.name] || p.name)}</option>`).join('');
    const grpOpts = ['<option value="">— elige grupo —</option>'].concat(vGroups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`)).join('');
    box.innerHTML = `
      <div class="rt-field"><label>Nombre de la campaña</label><input id="vwName" type="text" placeholder="p. ej. Views TikTok diarias"></div>
      <div class="rt-field"><label>Plataforma</label><select id="vwPlatform">${platOpts}</select></div>
      <div class="rt-field"><label>Objetivo</label>
        <div class="rt-radio">
          <label><input type="radio" name="vwTarget" value="selected" checked onchange="vwToggleTarget()"> Dispositivos seleccionados (<b>${selCount}</b>)</label>
          <label><input type="radio" name="vwTarget" value="group" onchange="vwToggleTarget()"> Grupo</label>
        </div>
        <select id="vwGroup" style="margin-top:6px" hidden>${grpOpts}</select>
      </div>
      <div class="rt-field"><label>Modo</label>
        <div class="rt-radio">
          <label><input type="radio" name="vwMode" value="one_shot" checked> Ejecutar ahora (una vez)</label>
          <label><input type="radio" name="vwMode" value="continuous"> Continua (por horario)</label>
        </div>
      </div>
      <h4 class="vw-h4">Parámetros del patrón</h4>
      <div class="rt-row">
        <label class="rt-half">Vistas por sesión<input id="vwViews" type="number" value="5" min="1"></label>
        <label class="rt-half">Duración por vídeo (s)<input id="vwDur" type="number" value="45" min="3"></label>
      </div>
      <div class="rt-row">
        <label class="rt-half">Prob. de like (0-1)<input id="vwLike" type="number" step="0.05" value="0.15" min="0" max="1"></label>
        <label class="rt-half">Prob. de follow (0-1)<input id="vwFollow" type="number" step="0.01" value="0.03" min="0" max="1"></label>
      </div>
      <div class="rt-editor-actions">
        <button class="rt-btn" onclick="vwPreview()">👁️ Vista previa</button>
        <button class="rt-btn primary" onclick="vwCreate()">🚀 Crear campaña</button>
      </div>
      <div id="vwMsg" class="rt-msg"></div>
      <div id="vwPreviewBox" class="vw-preview"></div>`;
  }

  window.vwToggleTarget = () => {
    const g = document.querySelector('input[name="vwTarget"]:checked').value;
    $('vwGroup').hidden = g !== 'group';
  };

  function collectConfig() {
    return {
      views_per_session: Number($('vwViews').value) || 5,
      video_duration_ms: (Number($('vwDur').value) || 45) * 1000,
      like_chance: Number($('vwLike').value) || 0,
      follow_chance: Number($('vwFollow').value) || 0,
    };
  }

  window.vwPreview = async () => {
    const msg = $('vwMsg'); const platform = $('vwPlatform').value;
    try {
      const r = await apiFetch('/views/pattern-preview', { method: 'POST', body: JSON.stringify({ platform, config: collectConfig() }) });
      // el endpoint devuelve { platform, pattern, steps:[...] } (o un array directo)
      const steps = Array.isArray(r.data) ? r.data : (r.data && r.data.steps) || [];
      const counts = steps.reduce((m, s) => (m[s.type] = (m[s.type] || 0) + 1, m), {});
      const patName = (r.data && r.data.pattern) ? ` (${r.data.pattern})` : '';
      $('vwPreviewBox').innerHTML = `<div class="vw-prev-head">Patrón generado${patName}: ${steps.length} pasos</div>` +
        Object.entries(counts).map(([t, n]) => `<span class="vw-prev-chip">${esc(t)} ×${n}</span>`).join('');
      msg.textContent = '';
    } catch (e) { msg.textContent = 'Error: ' + e.message; msg.className = 'rt-msg err'; }
  };

  window.vwCreate = async () => {
    const msg = $('vwMsg');
    const name = $('vwName').value.trim();
    const platform = $('vwPlatform').value;
    const mode = document.querySelector('input[name="vwMode"]:checked').value;
    const target = document.querySelector('input[name="vwTarget"]:checked').value;
    if (!name) { msg.textContent = 'Ponle nombre a la campaña.'; msg.className = 'rt-msg err'; return; }
    const body = { name, platform, mode, config: collectConfig() };
    if (target === 'group') {
      const gid = $('vwGroup').value;
      if (!gid) { msg.textContent = 'Elige un grupo.'; msg.className = 'rt-msg err'; return; }
      body.group_id = Number(gid);
    } else {
      const ids = (typeof selectedDeviceIds !== 'undefined') ? [...selectedDeviceIds] : [];
      if (!ids.length) { msg.textContent = 'Selecciona dispositivos en el panel (o usa un grupo).'; msg.className = 'rt-msg err'; return; }
      body.device_ids = ids;
    }
    try {
      const r = await apiFetch('/views/campaigns', { method: 'POST', body: JSON.stringify(body) });
      msg.textContent = '✔ ' + (r.message || 'Campaña creada') + (mode === 'one_shot' ? ' — ejecutándose…' : '');
      msg.className = 'rt-msg ok';
      await refresh(); renderStats(); renderList();
      if (typeof loadAll === 'function') loadAll();
    } catch (e) { msg.textContent = 'Error: ' + e.message; msg.className = 'rt-msg err'; }
  };

  async function renderCampaignDetail(c) {
    const box = $('vwEditor'); if (!box) return;
    box.innerHTML = `
      <div class="vw-detail-head">
        <h3>${esc(c.name)} <span class="vw-badge p-${esc(c.platform)}">${esc(PLAT_LABEL[c.platform] || c.platform)}</span></h3>
        <div class="rt-item-sub">${esc(STATUS_LABEL[c.status] || c.status)} · ${c.device_count || 0} dispositivos · ${c.mode === 'one_shot' ? 'una vez' : 'continua'}</div>
      </div>
      <div id="vwCampStats" class="vw-detail-stats">Cargando métricas…</div>
      <div class="rt-editor-actions">
        <button class="rt-btn" onclick="vwNew()">← Volver</button>
        <button class="rt-btn primary" onclick="vwRun('${c.id}')">▶️ Ejecutar ahora</button>
      </div>
      <div id="vwMsg" class="rt-msg"></div>`;
    try {
      const s = (await apiFetch('/views/campaigns/' + c.id + '/stats')).data || {};
      $('vwCampStats').innerHTML = `
        <div class="vw-stat"><span class="vw-n">${s.total_sessions ?? s.sessions ?? 0}</span><span class="vw-l">sesiones</span></div>
        <div class="vw-stat"><span class="vw-n">${s.completed ?? 0}</span><span class="vw-l">completadas</span></div>
        <div class="vw-stat"><span class="vw-n">${s.failed ?? 0}</span><span class="vw-l">fallidas</span></div>
        <div class="vw-stat"><span class="vw-n">${s.total_views ?? s.views ?? 0}</span><span class="vw-l">views</span></div>`;
    } catch (e) { $('vwCampStats').textContent = 'Sin métricas todavía.'; }
  }

  window.vwRun = async (id) => {
    const msg = $('vwMsg');
    if (msg) { msg.textContent = 'Lanzando campaña…'; msg.className = 'rt-msg'; }
    try {
      const r = await apiFetch('/views/campaigns/' + id + '/run', { method: 'POST', body: '{}' });
      if (msg) { msg.textContent = '▶️ ' + (r.message || 'Ejecutada'); msg.className = 'rt-msg ok'; }
      await refresh(); renderStats(); renderList();
      const c = campaigns.find(x => x.id === id); if (c) renderCampaignDetail(c);
      if (typeof loadAll === 'function') loadAll();
    } catch (e) { if (msg) { msg.textContent = 'Error: ' + e.message; msg.className = 'rt-msg err'; } }
  };
})();
