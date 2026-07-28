// ============================================================
// MCP AppControl Dashboard
// ============================================================

// Por defecto la misma URL que sirve el dashboard; se puede sobreescribir con
// localStorage 'mcp_api_base' cuando el dashboard y la API estén en puertos distintos.
const API_BASE = localStorage.getItem('mcp_api_base') || window.location.origin;
const API_V1 = `${API_BASE}/api/v1`;

let devices = [];
let workflows = [];
let groups = [];
let schedules = [];
let wsConnection = null;
let viewedDeviceId = null;
let screenFrameTimer = null;
let screenFrameInFlight = false;
let screenWallTimer = null;
const screenWallInFlight = new Set();
const screenWallRetryAt = new Map();
let screenWallDeviceIds = [];
let screenWallCursor = 0;
const MAX_CONCURRENT_SCREEN_CAPTURES = 3;
const selectedRoutineDeviceIds = new Set();
const selectedDeviceIds = new Set();

// Tipos de paso soportados por el agente (label amigable -> tipo + campos)
const STEP_TYPES = [
    { type: 'OPEN_APP', label: 'Abrir app', fields: [{ k: 'packageName', ph: 'com.spotify.music' }] },
    { type: 'GOTO_URL', label: 'Ir a URL', fields: [{ k: 'url', ph: 'https://youtube.com/results?search_query=...' }] },
    { type: 'CLICK_BY_TEXT', label: 'Tocar por texto', fields: [{ k: 'text', ph: 'Texto visible / descripción' }] },
    { type: 'CLICK_BY_ID', label: 'Tocar por ID', fields: [{ k: 'resourceId', ph: 'resource-id' }] },
    { type: 'SET_TEXT', label: 'Escribir texto', fields: [{ k: 'resourceId', ph: 'campo (resource-id)' }, { k: 'value', ph: 'texto a escribir' }] },
    { type: 'SCROLL', label: 'Scroll', fields: [{ k: 'direction', ph: 'down / up' }] },
    { type: 'PLAY_MEDIA', label: 'Reproducir (segundos)', fields: [{ k: 'durationSeconds', ph: '180', type: 'number' }] },
    { type: 'PAUSE_MEDIA', label: 'Pausar media', fields: [] },
    { type: 'WAIT', label: 'Esperar (ms)', fields: [{ k: 'duration', ph: '2000', type: 'number' }] },
    { type: 'WAIT_FOR_ELEMENT', label: 'Esperar elemento', fields: [{ k: 'text', ph: 'texto a esperar' }, { k: 'timeout', ph: 'seg (30)', type: 'number' }] },
    { type: 'PRESS_BACK', label: 'Botón atrás', fields: [] },
    { type: 'PRESS_HOME', label: 'Botón inicio', fields: [] },
    { type: 'CAPTURE_SCREEN', label: 'Captura de pantalla', fields: [] },

    // ---- Utilidades USB/ADB (para dispositivos conectados por cable) ----
    { type: 'TAP_XY', label: '· Tocar coordenada (USB)', fields: [{ k: 'x', ph: '540', type: 'number' }, { k: 'y', ph: '1200', type: 'number' }] },
    { type: 'TYPE_TEXT', label: '· Teclear texto (USB)', fields: [{ k: 'value', ph: 'texto' }] },
    { type: 'INPUT_KEYEVENT', label: '· Tecla/keyevent (USB)', fields: [{ k: 'keycode', ph: '66 = Enter, 4 = Atrás', type: 'number' }] },
    { type: 'START_ACTIVITY', label: '· Abrir actividad (USB)', fields: [{ k: 'component', ph: 'com.app/.MainActivity' }] },
    { type: 'INSTALL_APK', label: '· Instalar APK (USB)', fields: [{ k: 'apk_path', ph: 'C:\\ruta\\app.apk (en el PC)' }] },
    { type: 'UNINSTALL_APP', label: '· Desinstalar app (USB)', fields: [{ k: 'package_name', ph: 'com.app' }] },
    { type: 'CLEAR_APP', label: '· Borrar datos de app (USB)', fields: [{ k: 'package_name', ph: 'com.app' }] },
    { type: 'FORCE_STOP', label: '· Forzar detención (USB)', fields: [{ k: 'package_name', ph: 'com.app' }] },
    { type: 'GRANT_PERMISSION', label: '· Conceder permiso (USB)', fields: [{ k: 'package_name', ph: 'com.app' }, { k: 'permission', ph: 'android.permission.CAMERA' }] },
    { type: 'SETTINGS_PUT', label: '· Ajuste del sistema (USB)', fields: [{ k: 'namespace', ph: 'global / system / secure' }, { k: 'key', ph: 'airplane_mode_on' }, { k: 'value', ph: '1' }] },
    { type: 'SCREEN_ON', label: '· Encender pantalla (USB)', fields: [] },
    { type: 'SCREEN_OFF', label: '· Apagar pantalla (USB)', fields: [] },
    { type: 'UNLOCK', label: '· Desbloquear (sin PIN) (USB)', fields: [] },
    { type: 'MONKEY', label: '· Eventos aleatorios/Monkey (USB)', fields: [{ k: 'package_name', ph: 'com.app' }, { k: 'events', ph: '300', type: 'number' }, { k: 'throttle', ph: 'ms entre eventos (opcional)', type: 'number' }] },
    { type: 'PUSH_FILE', label: '· Enviar archivo al teléfono (USB)', fields: [{ k: 'local', ph: 'C:\\ruta\\archivo (PC)' }, { k: 'remote', ph: '/sdcard/archivo' }] },
    { type: 'PULL_FILE', label: '· Traer archivo del teléfono (USB)', fields: [{ k: 'remote', ph: '/sdcard/archivo' }, { k: 'local', ph: 'C:\\ruta\\destino (PC)' }] },
    { type: 'SCREEN_RECORD', label: '· Grabar pantalla (USB)', fields: [{ k: 'duration_seconds', ph: '10', type: 'number' }] },
    { type: 'REBOOT', label: '· Reiniciar dispositivo (USB)', fields: [] },
];

const RECIPES = {
    spotify: [
        { type: 'OPEN_APP', packageName: 'com.spotify.music' },
        { type: 'WAIT', duration: 3000 },
        { type: 'CLICK_BY_TEXT', text: 'Buscar' },
        { type: 'SET_TEXT', resourceId: 'search', value: 'Lofi beats' },
        { type: 'CLICK_BY_TEXT', text: 'Lofi beats' },
        { type: 'PLAY_MEDIA', durationSeconds: 180 },
        { type: 'SCROLL', direction: 'down' },
    ],
    youtube: [
        { type: 'GOTO_URL', url: 'https://www.youtube.com/results?search_query=lofi' },
        { type: 'WAIT', duration: 3000 },
        { type: 'CLICK_BY_TEXT', text: 'lofi' },
        { type: 'PLAY_MEDIA', durationSeconds: 120 },
    ],
};

// ============================================================
// Token / apiFetch
// ============================================================

function getApiToken() {
    // No usar prompt() aquí: bloquea el hilo y se dispararía en cada carga.
    // El token se pide explícitamente con el botón "Token" (changeToken).
    return localStorage.getItem('mcp_api_token') || '';
}

function changeToken() {
    const t = window.prompt('Nuevo API token:', localStorage.getItem('mcp_api_token') || '');
    if (t !== null) { localStorage.setItem('mcp_api_token', t.trim()); loadAll(); }
}

async function apiFetch(path, options = {}) {
    const headers = Object.assign(
        { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        options.headers || {},
        { 'Authorization': `Bearer ${getApiToken()}` }
    );
    const response = await fetch(`${API_V1}${path}`, { ...options, headers });
    if (response.status === 401) {
        localStorage.removeItem('mcp_api_token');
        addLog('Token inválido o ausente. Recarga e introduce uno válido.', 'error');
        throw new Error('Unauthorized');
    }
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${response.status}`);
    }
    return response.json();
}

function extractList(payload) {
    const d = payload?.data;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    return [];
}

// ============================================================
// Init
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    renderDays();
    addStep();
    onModeChange();
    initBatchBar();
    loadAll();
    connectWebSocket();
    setInterval(loadAll, 30000);
});

// ============================================================
// Acción rápida por lotes (ejecutar una utilidad en los seleccionados)
// ============================================================

function initBatchBar() {
    const sel = document.getElementById('batchCommand');
    if (!sel) return;
    sel.innerHTML = STEP_TYPES.map(s => `<option value="${s.type}">${s.label}</option>`).join('');
    renderBatchParams();
}

function renderBatchParams() {
    const sel = document.getElementById('batchCommand');
    const cont = document.getElementById('batchParams');
    if (!sel || !cont) return;
    const def = STEP_TYPES.find(s => s.type === sel.value);
    cont.innerHTML = (def?.fields || []).map(f =>
        `<input class="input" style="max-width:200px" data-key="${f.k}" type="${f.type || 'text'}" placeholder="${f.ph}">`
    ).join('');
}

async function runBatchCommand() {
    const msg = document.getElementById('batchMsg');
    const ids = [...selectedDeviceIds];
    if (!ids.length) { showMsg(msg, 'Selecciona al menos un dispositivo', 'err'); return; }

    const command = document.getElementById('batchCommand').value;
    const params = {};
    document.querySelectorAll('#batchParams input').forEach(inp => {
        let v = inp.value.trim();
        if (v === '') return;
        if (inp.type === 'number') v = parseInt(v, 10);
        params[inp.dataset.key] = v;
    });

    showMsg(msg, `Ejecutando en ${ids.length}…`, 'ok');
    try {
        const r = await apiFetch('/devices/batch-command', {
            method: 'POST',
            body: JSON.stringify({ device_ids: ids, command, params }),
        });
        const d = r.data || {};
        showMsg(msg, `✓ ${d.ok}/${d.total} ok${d.failed ? `, ${d.failed} fallaron` : ''}`, d.failed ? 'err' : 'ok');
        addLog(`Acción rápida "${command}" en ${d.total}: ${d.ok} ok, ${d.failed} fallo(s)`, d.failed ? 'warning' : 'info');
    } catch (e) {
        showMsg(msg, 'Error: ' + e.message, 'err');
    }
}

function setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });
}

async function loadAll() {
    if (!getApiToken()) {
        addLog('Configura el API token con el botón "Token" (arriba a la derecha).', 'warning');
        return;
    }
    try {
        devices = extractList(await apiFetch('/devices?per_page=100'));
        renderDevices();
        renderScreenWall();
        renderRoutineDeviceSelector();

        groups = extractList(await apiFetch('/groups'));
        renderGroups();
        fillGroupSelect();

        workflows = extractList(await apiFetch('/workflows'));
        renderRoutines();
        fillWorkflowSelect();

        schedules = extractList(await apiFetch('/schedules'));
        renderSchedules();

        const stats = await apiFetch('/dashboard/stats');
        updateStats(stats.data);
    } catch (e) {
        console.error(e);
        addLog('Error cargando datos: ' + e.message, 'error');
    }
}

function updateStats(s) {
    if (s?.devices) {
        setText('onlineDevices', s.devices.online || 0);
        setText('busyDevices', s.devices.busy || 0);
        setText('deviceOfflineCount', s.devices.offline || 0);
    }
    if (s?.tasks) setText('completedTasks', s.tasks.completed || 0);
    setText('activeSchedules', schedules.filter(x => x.is_active).length);
}

function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

// ============================================================
// Dispositivos / grupos
// ============================================================

function renderDevices() {
    const grid = document.getElementById('devicesGrid');
    if (!grid) return;
    selectedDeviceIds.forEach(id => {
        if (!devices.some(device => device.id === id)) selectedDeviceIds.delete(id);
    });
    const screenPreview = device => canViewScreen(device)
        ? `<button class="device-screen-preview" type="button" onclick="openScreenViewer(${Number(device.id)})" title="Abrir pantalla ampliada">
                <span class="device-screen-frame">
                    <img id="screenWallFrame-${Number(device.id)}" alt="Pantalla de ${escapeAttr(device.name || device.serial_number)}">
                    <span class="device-screen-placeholder" id="screenWallPlaceholder-${Number(device.id)}">Solicitando captura...</span>
                </span>
                <span class="device-screen-status" id="screenWallStatus-${Number(device.id)}">Conectando...</span>
            </button>`
        : `<div class="device-screen-preview is-unavailable">
                <span class="device-screen-frame"><span class="device-screen-placeholder">Pantalla no disponible sin conexión.</span></span>
                <span class="device-screen-status">Sin conexión</span>
            </div>`;
    grid.innerHTML = devices.map(d => `
        <div class="device-card ${selectedDeviceIds.has(d.id) ? 'is-selected' : ''}" data-name="${(d.name || '').toLowerCase()}">
            <div class="device-header">
                <label class="device-select" title="Seleccionar ${escapeAttr(d.name || d.serial_number)}">
                    <input type="checkbox" ${selectedDeviceIds.has(d.id) ? 'checked' : ''} onchange="toggleDeviceSelection(${Number(d.id)}, this.checked)">
                    <span class="device-name">${escapeHtml(d.name || '')}</span>
                </label>
                <span class="device-status-badge badge-${d.status}">${(d.status || '').toUpperCase()}</span>
            </div>
            <div class="device-info">
                <span>Serie: ${escapeHtml(d.serial_number || '')}</span>
                <span>Modelo: ${escapeHtml(d.model || 'N/A')}</span>
                <span>Conexión: ${d.transport === 'adb' ? '🔌 USB (ADB)' : '📶 Agente (WiFi)'}</span>
                <span>Grupo: ${escapeHtml(d.assigned_group?.name || 'Sin grupo')}</span>
                <span>Última conexión: ${formatTime(d.last_seen)}</span>
            </div>
            ${screenPreview(d)}
        </div>`).join('') || '<p style="padding:18px;color:var(--muted)">Sin dispositivos</p>';
    updateDeviceSelectionCount();
}

function canViewScreen(device) {
    return ['online', 'busy'].includes(device?.status);
}

function toggleDeviceSelection(deviceId, selected) {
    if (selected) selectedDeviceIds.add(deviceId);
    else selectedDeviceIds.delete(deviceId);
    renderDevices();
}

function selectAllDevices() {
    devices.forEach(device => selectedDeviceIds.add(device.id));
    renderDevices();
}

function clearDeviceSelection() {
    selectedDeviceIds.clear();
    renderDevices();
}

function updateDeviceSelectionCount() {
    const count = document.getElementById('deviceSelectionCount');
    if (count) count.textContent = `${selectedDeviceIds.size} seleccionados`;
}

function captureSelectedDeviceFrames() {
    const selectedOnline = devices.filter(device => selectedDeviceIds.has(device.id) && canViewScreen(device));
    if (!selectedOnline.length) {
        addLog('Selecciona al menos un dispositivo online para actualizar su pantalla.', 'warning');
        return;
    }
    selectedOnline.forEach(device => void requestScreenWallFrame(device.id));
}

function renderScreenWall() {
    const connectedDevices = devices.filter(canViewScreen);
    screenWallDeviceIds = connectedDevices.map(device => device.id);
    screenWallCursor = 0;

    if (!screenWallDeviceIds.length) {
        stopScreenWallPolling();
        return;
    }

    startScreenWallPolling();
}

function startScreenWallPolling() {
    stopScreenWallPolling();
    requestScreenWallFrames();
    screenWallTimer = window.setInterval(requestScreenWallFrames, 1250);
}

function stopScreenWallPolling() {
    if (screenWallTimer !== null) window.clearInterval(screenWallTimer);
    screenWallTimer = null;
    screenWallInFlight.clear();
    screenWallRetryAt.clear();
}

function requestScreenWallFrames() {
    const candidates = screenWallDeviceIds.filter(deviceId => deviceId !== viewedDeviceId);
    if (!candidates.length) return;

    const batchSize = Math.min(MAX_CONCURRENT_SCREEN_CAPTURES, candidates.length);
    for (let index = 0; index < batchSize; index += 1) {
        const deviceId = candidates[(screenWallCursor + index) % candidates.length];
        void requestScreenWallFrame(deviceId);
    }
    screenWallCursor = (screenWallCursor + batchSize) % candidates.length;
}

async function requestScreenWallFrame(deviceId) {
    if (screenWallInFlight.has(deviceId) || Date.now() < (screenWallRetryAt.get(deviceId) || 0)) return;
    screenWallInFlight.add(deviceId);

    try {
        const result = await apiFetch(`/devices/${deviceId}/screen-frame`, {
            method: 'POST',
            body: '{}',
        });
        const imageData = result.data?.image;
        const image = document.getElementById(`screenWallFrame-${deviceId}`);
        const placeholder = document.getElementById(`screenWallPlaceholder-${deviceId}`);
        if (!imageData || !image) throw new Error('Sin imagen');

        image.src = `data:${result.data?.mime || 'image/png'};base64,${imageData}`;
        if (placeholder) placeholder.hidden = true;
        screenWallRetryAt.delete(deviceId);
        setScreenWallStatus(deviceId, 'En directo');
    } catch (error) {
        screenWallRetryAt.set(deviceId, Date.now() + 5000);
        setScreenWallStatus(deviceId, screenCaptureErrorMessage(error), true);
    } finally {
        screenWallInFlight.delete(deviceId);
    }
}

function setScreenWallStatus(deviceId, message, isError = false) {
    const status = document.getElementById(`screenWallStatus-${deviceId}`);
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', isError);
}

function screenCaptureErrorMessage(error) {
    const message = error instanceof Error ? error.message : String(error || 'Error desconocido');

    if (message.includes('Screenshot requires Android 11+')) {
        return 'Requiere Android 11 o superior.';
    }

    if (message.includes('takeScreenshot failed with code 1')) {
        return 'Android rechazó la captura (error interno 1).';
    }

    if (message.includes('Servicio de accesibilidad no activo')) {
        return 'Activa el servicio de accesibilidad del agente.';
    }

    return message;
}

function filterDevices(q) {
    q = q.toLowerCase();
    document.querySelectorAll('.device-card').forEach(c => {
        c.style.display = (c.dataset.name || '').includes(q) ? '' : 'none';
    });
}

// ============================================================
// Screen viewer (one authenticated device at a time)
// ============================================================

function openScreenViewer(deviceId) {
    const device = devices.find(d => d.id === deviceId);
    if (!device || !canViewScreen(device)) return;

    if (screenFrameTimer !== null) window.clearInterval(screenFrameTimer);
    viewedDeviceId = device.id;
    const viewer = document.getElementById('screenViewer');
    const title = document.getElementById('screenViewerTitle');
    if (!viewer || !title) return;

    title.textContent = `Pantalla: ${device.name || device.serial_number}`;
    viewer.hidden = false;
    viewer.setAttribute('aria-hidden', 'false');
    setScreenViewerStatus('Solicitando captura...');
    requestScreenFrame();
    screenFrameTimer = window.setInterval(requestScreenFrame, 1250);
}

function closeScreenViewer() {
    if (screenFrameTimer !== null) window.clearInterval(screenFrameTimer);
    screenFrameTimer = null;
    screenFrameInFlight = false;
    viewedDeviceId = null;

    const viewer = document.getElementById('screenViewer');
    const image = document.getElementById('screenViewerImage');
    if (viewer) {
        viewer.hidden = true;
        viewer.setAttribute('aria-hidden', 'true');
    }
    if (image) image.removeAttribute('src');
    requestScreenWallFrames();
}

async function requestScreenFrame() {
    if (!viewedDeviceId || screenFrameInFlight) return;

    screenFrameInFlight = true;
    try {
        const result = await apiFetch(`/devices/${viewedDeviceId}/screen-frame`, {
            method: 'POST',
            body: '{}',
        });
        const imageData = result.data?.image;
        const image = document.getElementById('screenViewerImage');
        if (!imageData || !image) throw new Error('El dispositivo no devolvio una imagen.');

        image.src = `data:${result.data?.mime || 'image/png'};base64,${imageData}`;
        setScreenViewerStatus(`Actualizado ${new Date().toLocaleTimeString()}`);
    } catch (error) {
        setScreenViewerStatus(`No se pudo actualizar: ${screenCaptureErrorMessage(error)}`, true);
    } finally {
        screenFrameInFlight = false;
    }
}

function setScreenViewerStatus(message, isError = false) {
    const status = document.getElementById('screenViewerStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', isError);
}

function renderGroups() {
    const el = document.getElementById('groupsList');
    if (!el) return;
    el.innerHTML = groups.map(g => `
        <div class="list-item">
            <div>
                <div class="li-title">${escapeHtml(g.name)}</div>
                <div class="li-sub">${g.devices?.length ?? g.devices_count ?? 0} dispositivos${g.paused_at ? ' · PAUSADO' : ''}</div>
            </div>
        </div>`).join('') || '<p style="padding:18px;color:var(--muted)">Sin grupos</p>';
}

function fillGroupSelect() {
    const sel = document.getElementById('scheduleGroup');
    if (!sel) return;
    sel.innerHTML = '<option value="">Todos los dispositivos</option>' +
        groups.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
}

// ============================================================
// Constructor de rutinas
// ============================================================

function addStep(preset) {
    const list = document.getElementById('stepsList');
    const row = document.createElement('div');
    row.className = 'step-row';
    const optionsHtml = STEP_TYPES.map(s => `<option value="${s.type}">${s.label}</option>`).join('');
    row.innerHTML = `
        <div class="step-top">
            <span class="step-index"></span>
            <select onchange="renderStepParams(this)">${optionsHtml}</select>
            <button class="icon-btn" title="Subir" onclick="moveStep(this,-1)">↑</button>
            <button class="icon-btn" title="Bajar" onclick="moveStep(this,1)">↓</button>
            <button class="icon-btn" title="Eliminar" onclick="this.closest('.step-row').remove(); reindexSteps()">✕</button>
        </div>
        <div class="step-params"></div>`;
    list.appendChild(row);
    const select = row.querySelector('select');
    if (preset) select.value = preset.type;
    renderStepParams(select, preset);
    reindexSteps();
}

function renderStepParams(select, preset) {
    const def = STEP_TYPES.find(s => s.type === select.value);
    const container = select.closest('.step-row').querySelector('.step-params');
    container.innerHTML = (def?.fields || []).map(f =>
        `<input class="input" data-key="${f.k}" type="${f.type || 'text'}" placeholder="${f.ph}" value="${preset && preset[f.k] != null ? escapeAttr(preset[f.k]) : ''}">`
    ).join('') || '<span style="color:var(--muted);font-size:12px">Sin parámetros</span>';
}

function moveStep(btn, dir) {
    const row = btn.closest('.step-row');
    if (dir < 0 && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
    if (dir > 0 && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
    reindexSteps();
}

function reindexSteps() {
    document.querySelectorAll('#stepsList .step-row').forEach((r, i) => {
        r.querySelector('.step-index').textContent = (i + 1);
    });
}

function collectSteps() {
    const steps = [];
    document.querySelectorAll('#stepsList .step-row').forEach(row => {
        const type = row.querySelector('select').value;
        const step = { type };
        row.querySelectorAll('.step-params input').forEach(inp => {
            let v = inp.value.trim();
            if (v === '') return;
            if (inp.type === 'number') v = parseInt(v, 10);
            step[inp.dataset.key] = v;
        });
        steps.push(step);
    });
    return steps;
}

function loadRecipe(name) {
    document.getElementById('stepsList').innerHTML = '';
    if (name === 'clear') { addStep(); return; }
    (RECIPES[name] || []).forEach(s => addStep(s));
    if (name === 'spotify') { setVal('routineName', 'Sesión Spotify'); }
    if (name === 'youtube') { setVal('routineName', 'Sesión YouTube'); }
}

async function saveRoutine() {
    const name = getVal('routineName');
    const steps = collectSteps();
    const deviceIds = [...selectedRoutineDeviceIds];
    const msg = document.getElementById('routineMsg');
    if (!name) { showMsg(msg, 'Ponle un nombre a la rutina', 'err'); return; }
    if (!steps.length) { showMsg(msg, 'Añade al menos un paso', 'err'); return; }
    if (!deviceIds.length) { showMsg(msg, 'Selecciona al menos un dispositivo online', 'err'); return; }

    try {
        const created = await apiFetch('/workflows', {
            method: 'POST',
            body: JSON.stringify({ name, description: getVal('routineDesc'), steps, device_ids: deviceIds }),
        });
        const id = created.data?.id;
        // Los workflows se crean como 'draft'; activarlo para poder programarlo/ejecutarlo
        if (id) await apiFetch(`/workflows/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'active' }) });
        showMsg(msg, 'Rutina guardada y activada ✓', 'ok');
        addLog(`Rutina creada: ${name}`, 'info');
        selectedRoutineDeviceIds.clear();
        await loadAll();
    } catch (e) {
        showMsg(msg, 'Error: ' + e.message, 'err');
    }
}

function renderRoutines() {
    const el = document.getElementById('routinesList');
    if (!el) return;
    el.innerHTML = workflows.map(w => `
        <div class="list-item">
            <div>
                <div class="li-title">${escapeHtml(w.name)} <span class="li-sub">(${w.status})</span></div>
                <div class="li-sub">${Array.isArray(w.steps) ? w.steps.length : 0} pasos · ${w.target_devices?.length || 0} dispositivos seleccionados</div>
            </div>
            <div class="li-actions">
                <button class="btn btn-small" onclick="runWorkflow(${w.id})">Ejecutar ahora</button>
            </div>
        </div>`).join('') || '<p style="padding:18px;color:var(--muted)">Sin rutinas</p>';
}

async function runWorkflow(id) {
    try {
        const r = await apiFetch(`/workflows/${id}/execute`, { method: 'POST', body: JSON.stringify({}) });
        addLog(`Rutina ejecutada en ${r.data?.devices_assigned || 0} dispositivos`, 'info');
    } catch (e) {
        addLog('No se pudo ejecutar (¿dispositivos online?): ' + e.message, 'error');
    }
}

function renderRoutineDeviceSelector() {
    const container = document.getElementById('routineDevices');
    const hint = document.getElementById('routineDevicesHint');
    if (!container || !hint) return;

    const onlineDevices = devices.filter(canViewScreen);
    selectedRoutineDeviceIds.forEach(id => {
        if (!devices.some(device => device.id === id && canViewScreen(device))) selectedRoutineDeviceIds.delete(id);
    });

    hint.textContent = onlineDevices.length
        ? `${selectedRoutineDeviceIds.size} de ${onlineDevices.length} dispositivos online seleccionados.`
        : 'No hay dispositivos online disponibles para ejecutar una rutina.';

    container.innerHTML = devices.map(device => {
        const available = canViewScreen(device);
        const checked = selectedRoutineDeviceIds.has(device.id);
        return `<label class="routine-target">
            <input type="checkbox" value="${Number(device.id)}" ${checked ? 'checked' : ''} ${available ? '' : 'disabled'} onchange="toggleRoutineDevice(${Number(device.id)}, this.checked)">
            <span>
                <span class="routine-target-name">${escapeHtml(device.name || device.serial_number)}</span>
                <span class="routine-target-meta">${escapeHtml(device.serial_number)} · ${(device.status || 'offline').toUpperCase()}</span>
            </span>
        </label>`;
    }).join('') || '<p class="routine-targets-hint">No hay dispositivos registrados.</p>';
}

function toggleRoutineDevice(deviceId, selected) {
    if (selected) selectedRoutineDeviceIds.add(deviceId);
    else selectedRoutineDeviceIds.delete(deviceId);
    renderRoutineDeviceSelector();
}

function selectAllRoutineDevices() {
    devices.filter(canViewScreen).forEach(device => selectedRoutineDeviceIds.add(device.id));
    renderRoutineDeviceSelector();
}

function clearRoutineDeviceSelection() {
    selectedRoutineDeviceIds.clear();
    renderRoutineDeviceSelector();
}

function useConsoleSelectionForRoutine() {
    selectedRoutineDeviceIds.clear();
    devices
        .filter(device => selectedDeviceIds.has(device.id) && canViewScreen(device))
        .forEach(device => selectedRoutineDeviceIds.add(device.id));
    renderRoutineDeviceSelector();
}

function fillWorkflowSelect() {
    const sel = document.getElementById('scheduleWorkflow');
    if (!sel) return;
    const active = workflows.filter(w => w.status === 'active');
    sel.innerHTML = active.map(w => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('')
        || '<option value="">— crea una rutina primero —</option>';
}

// ============================================================
// Editor de horarios
// ============================================================

function renderDays() {
    const names = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const el = document.getElementById('daysRow');
    el.innerHTML = names.map((n, i) => `<span class="day-chip on" data-day="${i}" onclick="this.classList.toggle('on')">${n}</span>`).join('');
}

function onModeChange() {
    const mode = document.querySelector('input[name="scheduleMode"]:checked').value;
    document.getElementById('loopFields').style.display = mode === 'loop' ? '' : 'none';
    document.getElementById('fixedFields').style.display = mode === 'fixed_times' ? '' : 'none';
    if (mode === 'fixed_times' && !document.querySelector('#timesList .time-item')) addTime();
}

function addTime() {
    const el = document.getElementById('timesList');
    const div = document.createElement('div');
    div.className = 'time-item';
    div.innerHTML = `<input type="time" class="input" value="09:00"><button class="icon-btn" onclick="this.parentNode.remove()">✕</button>`;
    el.appendChild(div);
}

async function saveSchedule() {
    const msg = document.getElementById('scheduleMsg');
    const mode = document.querySelector('input[name="scheduleMode"]:checked').value;
    const days = [...document.querySelectorAll('#daysRow .day-chip.on')].map(c => parseInt(c.dataset.day, 10));

    const payload = {
        name: getVal('scheduleName'),
        workflow_id: parseInt(getVal('scheduleWorkflow'), 10),
        group_id: getVal('scheduleGroup') ? parseInt(getVal('scheduleGroup'), 10) : null,
        mode,
        days_of_week: days.length === 7 ? null : days,
    };
    if (!payload.name) { showMsg(msg, 'Ponle un nombre', 'err'); return; }
    if (!payload.workflow_id) { showMsg(msg, 'Elige una rutina', 'err'); return; }

    if (mode === 'loop') {
        payload.window_start = getVal('windowStart');
        payload.window_end = getVal('windowEnd');
        payload.loop_gap_seconds = parseInt(getVal('loopGap') || '0', 10);
    } else {
        payload.times = [...document.querySelectorAll('#timesList input')].map(i => i.value).filter(Boolean);
        if (!payload.times.length) { showMsg(msg, 'Añade al menos una hora', 'err'); return; }
    }

    try {
        await apiFetch('/schedules', { method: 'POST', body: JSON.stringify(payload) });
        showMsg(msg, 'Horario guardado ✓', 'ok');
        addLog(`Horario creado: ${payload.name}`, 'info');
        await loadAll();
    } catch (e) {
        showMsg(msg, 'Error: ' + e.message, 'err');
    }
}

function renderSchedules() {
    const el = document.getElementById('schedulesList');
    if (!el) return;
    el.innerHTML = schedules.map(s => {
        const when = s.mode === 'loop'
            ? `Bucle ${fmtTime(s.window_start)}–${fmtTime(s.window_end)} (pausa ${s.loop_gap_seconds}s)`
            : `Horas: ${(s.times || []).join(', ')}`;
        return `
        <div class="list-item">
            <div>
                <div class="li-title">${escapeHtml(s.name)} ${s.is_active ? '' : '<span class="li-sub">(pausado)</span>'}</div>
                <div class="li-sub">${escapeHtml(s.workflow?.name || 'rutina')} → ${escapeHtml(s.group?.name || 'Todos')}</div>
                <div class="li-sub">${when}${s.last_run_at ? ' · última: ' + formatTime(s.last_run_at) : ''}</div>
            </div>
            <div class="li-actions">
                <button class="btn btn-small" onclick="runSchedule(${s.id})">Ejecutar</button>
                <button class="btn btn-small" onclick="toggleSchedule(${s.id}, ${s.is_active})">${s.is_active ? 'Pausar' : 'Reanudar'}</button>
                <button class="btn btn-small btn-danger" onclick="deleteSchedule(${s.id})">Eliminar</button>
            </div>
        </div>`;
    }).join('') || '<p style="padding:18px;color:var(--muted)">Sin horarios</p>';
}

async function runSchedule(id) {
    try { const r = await apiFetch(`/schedules/${id}/run-now`, { method: 'POST' }); addLog(`Horario disparado en ${r.data?.devices_assigned || 0} dispositivos`, 'info'); }
    catch (e) { addLog('Error: ' + e.message, 'error'); }
}
async function toggleSchedule(id, active) {
    try { await apiFetch(`/schedules/${id}/${active ? 'pause' : 'resume'}`, { method: 'POST' }); await loadAll(); }
    catch (e) { addLog('Error: ' + e.message, 'error'); }
}
async function deleteSchedule(id) {
    if (!confirm('¿Eliminar este horario?')) return;
    try { await apiFetch(`/schedules/${id}`, { method: 'DELETE' }); await loadAll(); }
    catch (e) { addLog('Error: ' + e.message, 'error'); }
}

// ============================================================
// WebSocket (observador)
// ============================================================

function connectWebSocket() {
    const wsHost = localStorage.getItem('mcp_ws_host') || `${window.location.hostname}:6001`;
    try {
        const wsScheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
        wsConnection = new WebSocket(`${wsScheme}://${wsHost}/ws`);
        wsConnection.onopen = () => { setConn(true); wsConnection.send(JSON.stringify({ type: 'watch' })); };
        wsConnection.onmessage = (ev) => handleWs(JSON.parse(ev.data));
        wsConnection.onerror = () => setConn(false);
        wsConnection.onclose = () => { setConn(false); setTimeout(connectWebSocket, 5000); };
    } catch (e) { console.error(e); }
}

function handleWs(m) {
    switch (m.type) {
        case 'device_connected': addLog(`Dispositivo conectado: ${m.serial_number}`, 'info'); loadAll(); break;
        case 'device_offline': addLog(`Dispositivo desconectado: ${m.serial_number}`, 'warning'); loadAll(); break;
        case 'command_result': addLog(`${m.serial_number}: ${m.command} → ${m.success ? 'ok' : 'fallo'}`, m.success ? 'info' : 'error'); break;
        case 'screenshot_received': addLog(`Captura recibida de ${m.serial_number}`, 'info'); break;
    }
}

function setConn(ok) {
    const el = document.getElementById('connectionStatus');
    if (el) el.innerHTML = `<span class="status-dot" style="background:${ok ? 'var(--green)' : 'var(--red2)'}"></span> ${ok ? 'Conectado al WS' : 'Desconectado'}`;
}

// ============================================================
// Utilidades
// ============================================================

function addLog(message, level = 'info') {
    const el = document.getElementById('liveLogs');
    if (!el) return;
    const time = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-${level}">${escapeHtml(message)}</span>`;
    el.insertBefore(div, el.firstChild);
    while (el.children.length > 200) el.removeChild(el.lastChild);
}
function clearLogs() { const el = document.getElementById('liveLogs'); if (el) el.innerHTML = ''; }

function getVal(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function showMsg(el, text, cls) { el.textContent = text; el.className = 'form-msg ' + cls; setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 5000); }
function fmtTime(t) { return t ? String(t).slice(0, 5) : ''; }
function fmtTimeAlias(t) { return fmtTime(t); }

function formatTime(ts) {
    if (!ts) return 'N/A';
    try {
        const d = new Date(ts), diff = Date.now() - d.getTime();
        if (diff < 60000) return 'hace un momento';
        if (diff < 3600000) return `hace ${Math.floor(diff / 60000)} min`;
        return d.toLocaleString('es-ES');
    } catch { return ts; }
}
function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML; }
function escapeAttr(t) { return escapeHtml(t).replace(/"/g, '&quot;'); }
