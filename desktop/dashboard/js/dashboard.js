// ============================================================
// MCP AppControl · MCP Control Bsolutions V1 Dashboard Engine
// ============================================================

// Auto-reparación: una versión PWA anterior dejó un Service Worker registrado
// que interceptaba y rompía las llamadas a la API ("Failed to fetch" → sin
// dispositivos). Lo desregistramos y limpiamos su caché; si controlaba la
// página, recargamos una sola vez para recuperar el acceso a la red.
(function purgeStaleServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistrations().then(function (regs) {
    if (!regs.length) return;
    Promise.all(regs.map(function (r) { return r.unregister(); })).then(function () {
      var clear = window.caches ? caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }) : Promise.resolve();
      clear.finally(function () {
        if (!sessionStorage.getItem('sw_purged')) { sessionStorage.setItem('sw_purged', '1'); location.reload(); }
      });
    });
  }).catch(function () {});
})();

let apiOrigin = localStorage.getItem('mcp_api_base');
if (!apiOrigin || window.location.protocol === 'file:' || !window.location.origin || window.location.origin.startsWith('file:')) {
    apiOrigin = 'http://127.0.0.1:8733';
}
const API_BASE = apiOrigin;
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
const MAX_CONCURRENT_SCREEN_CAPTURES = 4;

const selectedDeviceIds = new Set();
const selectedRoutineDeviceIds = new Set();
let viewerDragState = null;

// Init
document.addEventListener('DOMContentLoaded', () => {
    loadAll();
    connectWebSocket();
    // Sondeo de respaldo cada 10s; los cambios reales llegan al instante por WebSocket
    // (device_connected/offline/devices_changed), así que no hace falta cada 4s.
    setInterval(loadAll, 10000);
});

function getApiToken() {
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
        // NO borrar el token: lo inyecta la app de escritorio al cargar la página.
        // Si una llamada corre antes de la inyección, borrarlo rompía todos los
        // botones y podía entrar en bucle de recarga. Solo reportamos.
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

async function loadAll() {
    try {
        devices = extractList(await apiFetch('/devices?per_page=100'));
        renderDevices();
        renderScreenWall();
        updateStats();
    } catch (e) {
        console.error('Error cargando dispositivos:', e);
    }

    try { groups = extractList(await apiFetch('/groups')); renderGroups(); } catch (e) {}
    try { workflows = extractList(await apiFetch('/workflows')); } catch (e) {}
    try { schedules = extractList(await apiFetch('/schedules')); } catch (e) {}
    try { const stats = await apiFetch('/dashboard/stats'); updateStats(stats.data); } catch (e) {}
}

function updateStats(s) {
    const total = devices.length;
    const online = devices.filter(d => d.status === 'online').length;
    const busy = devices.filter(d => d.status === 'busy').length;
    const offline = devices.filter(d => d.status === 'offline').length;

    setText('totalDevicesCount', total);
    setText('matrixTotalDevices', total);
    setText('statusWaitingCount', online);
    setText('statusRunningCount', busy);
    setText('onlineDevices', online);
    setText('busyDevices', busy);
    setText('deviceOfflineCount', offline);

    if (s?.tasks) {
        setText('completedTasks', s.tasks.completed || 0);
        setText('statusSuccessCount', s.tasks.completed || 0);
        setText('statusFailedCount', s.tasks.failed || 0);
    }
}

function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

// ============================================================
// NAVEGACIÓN Y TABS MCP CONTROL BSOLUTIONS
// ============================================================

function switchTab(tabId) {
    document.querySelectorAll('.sidebar .nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

    const btn = document.querySelector(`.sidebar .nav-item[data-tab="${tabId}"]`);
    if (btn) btn.classList.add('active');

    const panel = document.getElementById(tabId);
    if (panel) panel.classList.add('active');
}

function switchActionSubTab(subTabId, btnEl) {
    document.querySelectorAll('.sub-tabs .sub-tab').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');

    document.querySelectorAll('[id^="actionSubTab-"]').forEach(div => div.style.display = 'none');
    const target = document.getElementById(`actionSubTab-${subTabId}`);
    if (target) target.style.display = 'grid';
}

function toggleSidebar() {
    const sb = document.querySelector('.sidebar');
    if (sb) sb.classList.toggle('collapsed');
}

function setMatrixViewMode(mode) {
    const grid = document.getElementById('devicesGrid');
    const btnGrid = document.getElementById('btnViewGrid');
    const btnList = document.getElementById('btnViewList');

    if (mode === 'grid') {
        grid.classList.remove('list-view');
        btnGrid.classList.add('active');
        btnList.classList.remove('active');
    } else {
        grid.classList.add('list-view');
        btnList.classList.add('active');
        btnGrid.classList.remove('active');
    }
}

// ============================================================
// MATRIZ DE DISPOSITIVOS (PHONE MOCKUPS MCP CONTROL BSOLUTIONS)
// ============================================================

const lastDeviceScreenFrames = new Map();

function renderDevices() {
    const grid = document.getElementById('devicesGrid');
    if (!grid) return;

    selectedDeviceIds.forEach(id => {
        if (!devices.some(device => device.id === id)) selectedDeviceIds.delete(id);
    });

    grid.innerHTML = devices.map((d, index) => {
        const isOnline = ['online', 'busy'].includes(d.status);
        const statusText = d.status === 'busy' ? 'Operando' : (d.status === 'online' ? 'Listo' : 'Desconectado');
        const statusClass = d.status === 'busy' ? 'busy' : (d.status === 'online' ? 'online' : 'offline');
        const savedFrame = lastDeviceScreenFrames.get(d.id);

        return `
        <div class="phone-mockup-card ${selectedDeviceIds.has(d.id) ? 'selected' : ''}" data-device-id="${Number(d.id)}" data-name="${escapeAttr(d.name || d.serial_number)}" title="${escapeAttr(d.name || d.serial_number)}" onclick="openScreenViewer(${Number(d.id)})">
            <div class="phone-card-header">
                <span class="phone-status-badge ${statusClass}">
                    <span class="status-dot"></span> ${statusText}
                </span>
                <input type="checkbox" ${selectedDeviceIds.has(d.id) ? 'checked' : ''} onclick="event.stopPropagation(); toggleDeviceSelection(${Number(d.id)}, this.checked)">
            </div>

            <div class="phone-screen-frame">
                ${isOnline ? `
                    <img id="screenWallFrame-${Number(d.id)}" src="${savedFrame || ''}" style="${savedFrame ? 'display:block;' : 'display:none;'}" alt="Pantalla ${escapeAttr(d.name || d.serial_number)}">
                    <div class="phone-placeholder" id="screenWallPlaceholder-${Number(d.id)}" style="${savedFrame ? 'display:none;' : ''}">Cargando transmisión…</div>
                ` : `
                    <div class="phone-placeholder">Pantalla no disponible sin conexión</div>
                `}
            </div>

            <div class="phone-card-footer">
                ${index + 1} - ${d.transport === 'tcp' || String(d.serial_number).includes(':') ? 'WiFi' : 'USB'} ${escapeHtml(d.model || d.serial_number)}
                ${d.battery_level != null ? `<span class="hw-chip ${d.battery_level < 20 && !d.charging ? 'low' : ''}">${d.charging ? '⚡' : '🔋'}${d.battery_level}%${d.temperature_c != null ? ` · ${Math.round(d.temperature_c)}°C` : ''}</span>` : ''}
            </div>
            ${d.flagged ? `<div class="phone-card-flag" onclick="event.stopPropagation()">
                <span title="${escapeAttr(d.flag_reason || '')}">⚠️ ${esc_flag(d.flag_category)}</span>
                <button onclick="event.stopPropagation(); clearDeviceFlag(${Number(d.id)})">Quitar marca</button>
            </div>` : ''}
            <div class="phone-card-proxy" onclick="event.stopPropagation()">
                <span class="proxy-badge ${d.proxy_enabled ? 'on' : 'off'}" title="${d.proxy_enabled ? escapeAttr(`Proxy: ${d.proxy_host}:${d.proxy_port}`) : 'Sin proxy'}">
                    🌐 ${d.proxy_enabled ? escapeHtml(`${d.proxy_host}:${d.proxy_port}`) : 'Directo'}${d.last_ip ? ` · IP ${escapeHtml(d.last_ip)}` : ''}
                </span>
                <button class="proxy-btn" onclick="event.stopPropagation(); openProxyModal(${Number(d.id)})">Proxy/IP</button>
            </div>
        </div>`;
    }).join('') || '<p class="muted-text" style="grid-column:1/-1;padding:24px;text-align:center">No hay dispositivos registrados.</p>';

    updateSelectionUI();
}

function canViewScreen(device) {
    return ['online', 'busy'].includes(device?.status);
}

function toggleDeviceSelection(deviceId, selected) {
    if (selected) selectedDeviceIds.add(deviceId);
    else selectedDeviceIds.delete(deviceId);
    renderDevices();
}

function toggleSelectAllDevices(checked) {
    if (checked) devices.forEach(d => selectedDeviceIds.add(d.id));
    else selectedDeviceIds.clear();
    renderDevices();
}

function updateSelectionUI() {
    setText('selectedCountNum', selectedDeviceIds.size);
    const selAllCheck = document.getElementById('selectAllCheckbox');
    if (selAllCheck) selAllCheck.checked = devices.length > 0 && selectedDeviceIds.size === devices.length;
}

// ============================================================
// TRANSMISIÓN MULTI-PANTALLA (SCREEN WALL MATRIX)
// ============================================================

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

// Rastrea qué tarjetas del muro están visibles en el viewport, para no capturar
// las 40 pantallas a la vez sino solo las que el operador está viendo.
const wallVisibleIds = new Set();
let wallObserver = null;
function setupWallVisibility() {
    if (!('IntersectionObserver' in window)) return;
    if (!wallObserver) {
        wallObserver = new IntersectionObserver((entries) => {
            for (const e of entries) {
                const id = Number(e.target.getAttribute('data-device-id'));
                if (!id) continue;
                if (e.isIntersecting) wallVisibleIds.add(id); else wallVisibleIds.delete(id);
            }
        }, { root: null, threshold: 0.1 });
    }
    wallObserver.disconnect();
    wallVisibleIds.clear();
    document.querySelectorAll('.phone-mockup-card[data-device-id]').forEach(el => wallObserver.observe(el));
}

function startScreenWallPolling() {
    stopScreenWallPolling();
    setupWallVisibility();
    requestScreenWallFrames();
    // 1s es suficiente: el servidor cachea las miniaturas ~1.5s y solo se piden las visibles.
    screenWallTimer = window.setInterval(requestScreenWallFrames, 1000);
}

function stopScreenWallPolling() {
    if (screenWallTimer !== null) window.clearInterval(screenWallTimer);
    screenWallTimer = null;
    screenWallInFlight.clear();
    screenWallRetryAt.clear();
}

function requestScreenWallFrames() {
    let candidates = screenWallDeviceIds.filter(deviceId => deviceId !== viewedDeviceId);
    // Escala 40+: solo captura las tarjetas realmente visibles en el viewport.
    if (wallVisibleIds.size) candidates = candidates.filter(id => wallVisibleIds.has(id));
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
        const result = await apiFetch(`/devices/${deviceId}/screen-frame?thumb=1`, { method: 'POST', body: '{}' });
        const imageData = result.data?.image;

        if (imageData) {
            const srcUrl = `data:${result.data?.mime || 'image/png'};base64,${imageData}`;
            lastDeviceScreenFrames.set(deviceId, srcUrl);
            const image = document.getElementById(`screenWallFrame-${deviceId}`);
            const placeholder = document.getElementById(`screenWallPlaceholder-${deviceId}`);
            if (image) {
                image.src = srcUrl;
                image.style.display = 'block';
            }
            if (placeholder) {
                placeholder.style.display = 'none';
            }
        }
        screenWallRetryAt.delete(deviceId);
    } catch (error) {
        screenWallRetryAt.set(deviceId, Date.now() + 500);
    } finally {
        screenWallInFlight.delete(deviceId);
    }
}

// ==========================================
// VENTANA FLOTANTE DE CONTROL INTERACTIVO (FLOATING MIRROR WINDOW)
// ==========================================

function openScreenViewer(deviceId) {
    const device = devices.find(d => d.id === deviceId);
    if (!device || !canViewScreen(device)) return;

    if (screenFrameTimer !== null) window.clearInterval(screenFrameTimer);
    viewedDeviceId = device.id;
    const windowEl = document.getElementById('floatingMirrorWindow');
    if (!windowEl) return;

    setText('mirrorDeviceNum', devices.findIndex(d => d.id === deviceId) + 1);
    setText('mirrorDeviceStatus', device.status === 'busy' ? 'Operando' : 'Listo');
    windowEl.hidden = false;

    setScreenViewerStatus('Conectando flujo en vivo…');
    document.addEventListener('keydown', handleViewerKeyDown);

    requestScreenFrame();
    screenFrameTimer = window.setInterval(requestScreenFrame, 250);
}

function closeScreenViewer() {
    if (screenFrameTimer !== null) window.clearInterval(screenFrameTimer);
    screenFrameTimer = null;
    screenFrameInFlight = false;
    viewedDeviceId = null;
    viewerDragState = null;

    document.removeEventListener('keydown', handleViewerKeyDown);

    const windowEl = document.getElementById('floatingMirrorWindow');
    const image = document.getElementById('screenViewerImage');
    if (windowEl) windowEl.hidden = true;
    if (image) image.removeAttribute('src');

    requestScreenWallFrames();
}

async function requestScreenFrame() {
    if (!viewedDeviceId || screenFrameInFlight) return;
    screenFrameInFlight = true;

    try {
        const result = await apiFetch(`/devices/${viewedDeviceId}/screen-frame`, { method: 'POST', body: '{}' });
        const imageData = result.data?.image;
        const image = document.getElementById('screenViewerImage');

        if (imageData && image) {
            const srcUrl = `data:${result.data?.mime || 'image/png'};base64,${imageData}`;
            image.src = srcUrl;
            lastDeviceScreenFrames.set(viewedDeviceId, srcUrl);
            const matrixImg = document.getElementById(`screenWallFrame-${viewedDeviceId}`);
            if (matrixImg) {
                matrixImg.src = srcUrl;
                matrixImg.style.display = 'block';
            }
            setScreenViewerStatus(`En vivo (${result.data?.source || 'adb'}) ${new Date().toLocaleTimeString()}`);
        }
    } catch (error) {
        setScreenViewerStatus('Error de captura', true);
    } finally {
        screenFrameInFlight = false;
    }
}

function setScreenViewerStatus(message, isError = false) {
    const status = document.getElementById('screenViewerStatus');
    if (!status) return;
    status.textContent = message;
    status.style.color = isError ? '#f87171' : '#38bdf8';
}

// GESTOS MOUSE / SWIPE / TECLADO
function handleMouseDown(event) {
    if (!viewedDeviceId) return;
    const img = event.target;
    const rect = img.getBoundingClientRect();
    const scaleX = (img.naturalWidth || 1080) / rect.width;
    const scaleY = (img.naturalHeight || 2400) / rect.height;

    viewerDragState = {
        startX: Math.round((event.clientX - rect.left) * scaleX),
        startY: Math.round((event.clientY - rect.top) * scaleY),
        time: Date.now()
    };
}

async function handleMouseUp(event) {
    if (!viewedDeviceId || !viewerDragState) return;
    const img = event.target;
    const rect = img.getBoundingClientRect();
    const scaleX = (img.naturalWidth || 1080) / rect.width;
    const scaleY = (img.naturalHeight || 2400) / rect.height;

    const endX = Math.round((event.clientX - rect.left) * scaleX);
    const endY = Math.round((event.clientY - rect.top) * scaleY);
    const startX = viewerDragState.startX;
    const startY = viewerDragState.startY;
    const duration = Math.min(Math.max(Date.now() - viewerDragState.time, 150), 1000);
    viewerDragState = null;

    const dist = Math.hypot(endX - startX, endY - startY);

    if (dist < 12) {
        setScreenViewerStatus(`Tap (${startX}, ${startY})`);
        await sendVirtualControl('TAP_XY', { x: startX, y: startY });
    } else {
        setScreenViewerStatus(`Swipe`);
        await sendVirtualControl('SWIPE', { start_x: startX, start_y: startY, end_x: endX, end_y: endY, duration });
    }
}

let wheelDebounceTimer = null;
async function handleWheel(event) {
    if (!viewedDeviceId) return;
    event.preventDefault();
    if (wheelDebounceTimer) return;

    const direction = event.deltaY > 0 ? 'down' : 'up';
    setScreenViewerStatus(`Scroll ${direction}`);
    wheelDebounceTimer = setTimeout(() => { wheelDebounceTimer = null; }, 250);

    await sendVirtualControl('SCROLL', { direction });
}

async function handleViewerKeyDown(event) {
    if (!viewedDeviceId) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

    if (event.key === 'Backspace') {
        event.preventDefault();
        await sendVirtualControl('INPUT_KEYEVENT', { keycode: 67 });
    } else if (event.key === 'Enter') {
        event.preventDefault();
        await sendVirtualControl('INPUT_KEYEVENT', { keycode: 66 });
    } else if (event.key === 'Escape') {
        event.preventDefault();
        await sendVirtualControl('PRESS_BACK');
    } else if (event.key === 'Home') {
        event.preventDefault();
        await sendVirtualControl('PRESS_HOME');
    } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        await sendVirtualControl('TYPE_TEXT', { value: event.key });
    }
}

async function sendVirtualControl(command, params = {}) {
    if (!viewedDeviceId) return;
    try {
        await apiFetch('/devices/batch-command', {
            method: 'POST',
            body: JSON.stringify({ device_ids: [viewedDeviceId], command, params })
        });
        setTimeout(requestScreenFrame, 150);
    } catch (e) {
        setScreenViewerStatus(`Error: ${e.message}`, true);
    }
}

async function sendVirtualText() {
    if (!viewedDeviceId) return;
    const text = window.prompt('Texto a escribir en el dispositivo:');
    if (!text) return;
    await sendVirtualControl('TYPE_TEXT', { value: text });
}

// ============================================================
// ACCIONES RÁPIDAS (ACCIONES EN LOTE MCP CONTROL BSOLUTIONS)
// ============================================================

async function quickAction(command, params = {}) {
    let ids = [...selectedDeviceIds];
    if (!ids.length) {
        // Si no hay seleccionados, aplicamos a todos los dispositivos online
        ids = devices.filter(d => ['online', 'busy'].includes(d.status)).map(d => d.id);
    }
    if (!ids.length) { alert('No hay dispositivos online seleccionados'); return; }

    addLog(`Ejecutando "${command}" en ${ids.length} dispositivos…`, 'info');
    try {
        const r = await apiFetch('/devices/batch-command', {
            method: 'POST',
            body: JSON.stringify({ device_ids: ids, command, params })
        });
        const d = r.data || {};
        addLog(`✓ "${command}": ${d.ok}/${d.total} ok`, d.failed ? 'warning' : 'info');
    } catch (e) {
        addLog(`Error en acción "${command}": ${e.message}`, 'error');
    }
}

// ==========================================
// MODAL CUSTOM IN-APP (REEMPLAZO TOTAL DE PROMPT)
// ==========================================
let modalResolveFn = null;

function customPrompt(title, desc, defaultValue = '', placeholder = '') {
    return new Promise((resolve) => {
        const overlay = document.getElementById('inputModal');
        const titleEl = document.getElementById('inputModalTitle');
        const descEl = document.getElementById('inputModalDesc');
        const fieldEl = document.getElementById('inputModalField');
        const confirmBtn = document.getElementById('inputModalConfirmBtn');

        if (!overlay) {
            resolve(window.prompt(`${title}\n${desc}`, defaultValue));
            return;
        }

        modalResolveFn = resolve;
        titleEl.textContent = title;
        descEl.textContent = desc || '';
        fieldEl.value = defaultValue;
        fieldEl.placeholder = placeholder || '';
        overlay.hidden = false;
        fieldEl.focus();

        const handleConfirm = () => {
            const val = fieldEl.value;
            closeInputModal(val);
        };

        const handleKeyDown = (e) => {
            if (e.key === 'Enter') handleConfirm();
            if (e.key === 'Escape') closeInputModal(null);
        };

        confirmBtn.onclick = handleConfirm;
        fieldEl.onkeydown = handleKeyDown;
    });
}

function closeInputModal(resultValue = null) {
    const overlay = document.getElementById('inputModal');
    if (overlay) overlay.hidden = true;
    if (modalResolveFn) {
        const fn = modalResolveFn;
        modalResolveFn = null;
        fn(resultValue);
    }
}

async function promptOpenApp() {
    const pkg = await customPrompt('Abrir Aplicación', 'Introduce el nombre del paquete (ej: com.zhiliaoapp.musically)', 'com.zhiliaoapp.musically');
    if (pkg) quickAction('OPEN_APP', { packageName: pkg, package_name: pkg });
}

async function promptCloseApp() {
    const pkg = await customPrompt('Cerrar Aplicación', 'Paquete de la App a cerrar (Forzar detención):', 'com.zhiliaoapp.musically');
    if (pkg) quickAction('FORCE_STOP', { package_name: pkg });
}

async function promptClearApp() {
    const pkg = await customPrompt('Borrar Datos de App', 'Paquete de la App a borrar datos:', 'com.zhiliaoapp.musically');
    if (pkg) quickAction('CLEAR_APP', { package_name: pkg });
}

async function promptGrantPermission() {
    const pkg = await customPrompt('Conceder Permiso', 'Paquete de la App:', 'com.zhiliaoapp.musically');
    if (!pkg) return;
    const perm = await customPrompt('Conceder Permiso', 'Permiso a conceder (ej: android.permission.CAMERA):', 'android.permission.CAMERA');
    if (perm) quickAction('GRANT_PERMISSION', { package_name: pkg, permission: perm });
}

async function promptInstallApk() {
    const apk = await customPrompt('Instalar APK', 'Ruta absoluta del archivo APK en tu PC (ej: C:\\apks\\app.apk):');
    if (apk) quickAction('INSTALL_APK', { apk_path: apk });
}

async function promptUninstallApk() {
    const pkg = await customPrompt('Desinstalar APK', 'Nombre del paquete a desinstalar:', 'com.zhiliaoapp.musically');
    if (pkg) quickAction('UNINSTALL_APP', { package_name: pkg });
}

async function promptUploadGallery() {
    const file = await customPrompt('Subir Multimedia a Galería', 'Ruta absoluta del archivo en tu PC (ej: C:\\media\\video.mp4):');
    if (file) quickAction('PUSH_FILE', { local: file, remote: '/sdcard/DCIM/Camera/' + file.split(/[\/\\]/).pop() });
}

async function scanTcpDevices() {
    const address = await customPrompt('Escanear Dispositivo ADB TCP (WiFi)', 'Introduce la dirección IP y puerto del dispositivo:', '192.168.1.50:5555', '192.168.1.50:5555');
    if (!address || !address.trim()) return;

    addLog(`Escaneando y conectando dispositivo TCP ${address}…`, 'info');
    try {
        const res = await apiFetch('/devices/connect-tcp', {
            method: 'POST',
            body: JSON.stringify({ address: address.trim() })
        });
        if (res.success) {
            addLog(`✓ ${res.message}`, 'info');
            await loadAll();
        } else {
            addLog(`Error TCP: ${res.message}`, 'error');
            alert(`No se pudo conectar a ${address}: ${res.message}`);
        }
    } catch (e) {
        addLog(`Error conectando TCP: ${e.message}`, 'error');
        alert(`Error al conectar TCP: ${e.message}`);
    }
}

async function addNewGroupPrompt() {
    const name = await customPrompt('Agregar Grupo', 'Nombre del nuevo grupo de dispositivos:');
    if (!name) return;
    apiFetch('/groups', { method: 'POST', body: JSON.stringify({ name }) })
        .then(() => { loadAll(); addLog(`Grupo "${name}" creado`, 'info'); })
        .catch(e => alert(e.message));
}

async function assignSelectedToGroup() {
    const groupName = await customPrompt('Mover a Grupo', 'ID o nombre del grupo al que mover los dispositivos:');
    if (!groupName) return;
    const targetGroup = groups.find(g => String(g.id) === groupName || g.name.toLowerCase() === groupName.toLowerCase());
    if (!targetGroup) { alert('Grupo no encontrado'); return; }

    apiFetch(`/groups/${targetGroup.id}/assign-devices`, { method: 'POST', body: JSON.stringify({ device_ids: [...selectedDeviceIds] }) })
        .then(() => { loadAll(); addLog(`Dispositivos movidos al grupo ${targetGroup.name}`, 'info'); })
        .catch(e => alert(e.message));
}

// ============================================================
// GRUPOS Y RUTINAS
// ============================================================

function renderGroups() {
    const el = document.getElementById('groupsList');
    if (!el) return;
    el.innerHTML = groups.map(g => `
        <div class="list-item" style="padding:6px 0;border-bottom:1px solid #f1f5f9">
            <span style="font-size:12px;font-weight:600">${escapeHtml(g.name)}</span>
            <span style="font-size:11px;color:var(--text-muted)">${g.devices?.length || 0} devs</span>
        </div>`).join('') || '<p style="font-size:11px;color:var(--text-muted)">Sin grupos personalizados</p>';
}

function filterDevices(q) {
    q = (q || '').toLowerCase();
    document.querySelectorAll('.phone-mockup-card').forEach(card => {
        const title = (card.getAttribute('title') || card.dataset.name || '').toLowerCase();
        card.style.display = title.includes(q) ? 'flex' : 'none';
    });
}

async function testGoToSpotify() {
    if (!Array.isArray(devices) || !devices.length) {
        alert('Cargando dispositivos… Por favor, reintenta en un segundo.');
        return;
    }
    let targetDev = devices.find(d => ['online', 'busy'].includes(d?.status));
    if (selectedDeviceIds.size > 0) {
        const selectedId = [...selectedDeviceIds][0];
        targetDev = devices.find(d => String(d.id) === String(selectedId)) || targetDev;
    }
    if (!targetDev) { alert('No hay dispositivos online conectados'); return; }

    addLog(`[Prueba 1] Abriendo Spotify en Dispositivo 1 (${targetDev.name || targetDev.serial_number})…`, 'info');
    try {
        await apiFetch('/devices/batch-command', {
            method: 'POST',
            body: JSON.stringify({
                device_ids: [targetDev.id],
                command: 'OPEN_APP',
                params: { packageName: 'com.spotify.music', package_name: 'com.spotify.music' }
            })
        });
        addLog(`✓ Spotify abierto en Dispositivo 1 (${targetDev.serial_number})`, 'info');
    } catch (e) {
        addLog(`Error al abrir Spotify: ${e.message}`, 'error');
    }
}

async function testPlayLikedSongs() {
    if (!Array.isArray(devices) || !devices.length) {
        alert('Cargando dispositivos… Por favor, reintenta en un segundo.');
        return;
    }
    let targetDev = devices.find(d => ['online', 'busy'].includes(d?.status));
    if (selectedDeviceIds.size > 0) {
        const selectedId = [...selectedDeviceIds][0];
        targetDev = devices.find(d => String(d.id) === String(selectedId)) || targetDev;
    }
    if (!targetDev) { alert('No hay dispositivos online conectados'); return; }

    addLog(`[Prueba 2] Abriendo coleccion Me Gusta y reproduciendo en Dispositivo 1 (${targetDev.name || targetDev.serial_number})…`, 'info');
    try {
        await apiFetch('/devices/batch-command', {
            method: 'POST',
            body: JSON.stringify({
                device_ids: [targetDev.id],
                command: 'GOTO_URL',
                params: { url: 'spotify:user:spotify:collection' }
            })
        });

        setTimeout(async () => {
            try {
                await apiFetch('/devices/batch-command', {
                    method: 'POST',
                    body: JSON.stringify({
                        device_ids: [targetDev.id],
                        command: 'INPUT_KEYEVENT',
                        params: { keycode: 126 }
                    })
                });
                addLog(`✓ Reproducción "Me Gusta" enviada a Dispositivo 1 (${targetDev.serial_number})`, 'info');
            } catch (err) {
                console.error(err);
            }
        }, 2500);
    } catch (err) {
        console.error('testPlayLikedSongs:', err);
    }
}

async function testPlaySpecificTrack(url = 'https://open.spotify.com/intl-es/track/2lTm559tuIvatlT1u0JYG2?si=90db6bf259ae4d44') {
    if (!Array.isArray(devices) || !devices.length) {
        alert('Cargando dispositivos… Por favor, reintenta en un segundo.');
        return;
    }
    let targetDev = devices.find(d => ['online', 'busy'].includes(d?.status));
    if (selectedDeviceIds.size > 0) {
        const selectedId = [...selectedDeviceIds][0];
        targetDev = devices.find(d => String(d.id) === String(selectedId)) || targetDev;
    }
    if (!targetDev) { alert('No hay dispositivos online conectados'); return; }

    let trackUri = url;
    const match = url.match(/track\/([a-zA-Z0-9]+)/);
    if (match) {
        trackUri = `spotify:track:${match[1]}`;
    }

    addLog(`[Canción] Abriendo track (${trackUri}) en Dispositivo 1 (${targetDev.name || targetDev.serial_number})…`, 'info');
    try {
        await apiFetch('/devices/batch-command', {
            method: 'POST',
            body: JSON.stringify({
                device_ids: [targetDev.id],
                command: 'GOTO_URL',
                params: { url: trackUri }
            })
        });

        setTimeout(async () => {
            try {
                await apiFetch('/devices/batch-command', {
                    method: 'POST',
                    body: JSON.stringify({
                        device_ids: [targetDev.id],
                        command: 'INPUT_KEYEVENT',
                        params: { keycode: 126 }
                    })
                });
                addLog(`✓ Reproducción iniciada en Dispositivo 1 (${targetDev.serial_number})`, 'info');
            } catch (err) {
                console.error(err);
            }
        }, 2200);

    } catch (e) {
        addLog(`Error al reproducir canción: ${e.message}`, 'error');
    }
}

async function promptPlayCustomTrackUrl() {
    const inputUrl = await customPrompt(
        'Reproducir Canción de Spotify',
        'Introduce la URL o enlace de la canción a reproducir:',
        'https://open.spotify.com/intl-es/track/2lTm559tuIvatlT1u0JYG2',
        'https://open.spotify.com/track/...'
    );
    if (!inputUrl || !inputUrl.trim()) return;

    let ids = [...selectedDeviceIds];
    if (!ids.length) {
        ids = devices.filter(d => ['online', 'busy'].includes(d?.status)).map(d => d.id);
    }
    if (!ids.length) {
        alert('No hay dispositivos online conectados para reproducir');
        return;
    }

    let trackUri = inputUrl.trim();
    const match = trackUri.match(/track\/([a-zA-Z0-9]+)/);
    if (match) {
        trackUri = `spotify:track:${match[1]}`;
    }

    addLog(`[Auto-Play] Reproduciendo enlace (${trackUri}) en ${ids.length} dispositivo(s) seleccionados…`, 'info');

    try {
        await apiFetch('/devices/batch-command', {
            method: 'POST',
            body: JSON.stringify({
                device_ids: ids,
                command: 'GOTO_URL',
                params: { url: trackUri }
            })
        });

        setTimeout(async () => {
            try {
                await apiFetch('/devices/batch-command', {
                    method: 'POST',
                    body: JSON.stringify({
                        device_ids: ids,
                        command: 'INPUT_KEYEVENT',
                        params: { keycode: 126 }
                    })
                });
                addLog(`✓ Canción en reproducción en ${ids.length} dispositivo(s)`, 'info');
            } catch (err) {
                console.error(err);
            }
        }, 2200);

    } catch (e) {
        addLog(`Error en reproducción masiva: ${e.message}`, 'error');
    }
}

function loadRecipe(recipeName) {
    if (recipeName === 'spotify') {
        quickAction('OPEN_APP', { packageName: 'com.spotify.music' });
    } else if (recipeName === 'youtube') {
        quickAction('GOTO_URL', { url: 'https://youtube.com' });
    }
}

function connectWebSocket() {
    let wsHost = localStorage.getItem('mcp_ws_host');
    if (!wsHost || window.location.protocol === 'file:' || !window.location.hostname) {
        wsHost = '127.0.0.1:6011';
    }
    try {
        const wsScheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
        wsConnection = new WebSocket(`${wsScheme}://${wsHost}/ws`);
        wsConnection.onopen = () => { wsConnection.send(JSON.stringify({ type: 'watch' })); };
        wsConnection.onmessage = (ev) => {
            try {
                const m = JSON.parse(ev.data);
                // Refresco inmediato empujado por el backend (evita depender del sondeo).
                if (['device_connected', 'device_offline', 'devices_changed', 'command_result'].includes(m.type)) loadAll();
                if (m.type === 'notification') { if (typeof mcpOnNotification === 'function') mcpOnNotification(); loadAll(); }
            } catch (err) {}
        };
        wsConnection.onclose = () => setTimeout(connectWebSocket, 4000);
        wsConnection.onerror = () => {};
    } catch (e) {
        console.error('WebSocket connection error:', e);
    }
}

function addLog(message, level = 'info') {
    const el = document.getElementById('liveLogs');
    if (!el) return;
    const time = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.innerHTML = `<span style="color:#64748b">[${time}]</span> <span class="log-${level}">${escapeHtml(message)}</span>`;
    el.insertBefore(div, el.firstChild);
}

function clearLogs() { const el = document.getElementById('liveLogs'); if (el) el.innerHTML = ''; }
function renderRoutines() {}
function renderDays() {}
function addStep() {}
function saveRoutine() {}

function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML; }
function escapeAttr(t) { return escapeHtml(t).replace(/"/g, '&quot;'); }
function esc_flag(c) { return ({ captcha: 'Captcha', verification: 'Verificación', ban: 'Baneo', rate_limit: 'Límite', login: 'Sesión' })[c] || 'Marcado'; }

// ============================================================
// PROXY / IP DE SALIDA POR DISPOSITIVO
// ============================================================
function openProxyModal(deviceId) {
    const d = devices.find(x => x.id === deviceId);
    if (!d) return;
    document.getElementById('proxyModal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'proxyModal';
    overlay.className = 'proxy-modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `
      <div class="proxy-modal">
        <h3>Proxy / IP · ${escapeHtml(d.name || d.serial_number)}</h3>
        <p class="proxy-modal-sub">Enruta el tráfico del teléfono por una IP de salida. El proxy se aplica por ADB (proxy HTTP global de Android).</p>
        <label>Host / IP del proxy
          <input id="pxHost" type="text" placeholder="p. ej. 192.168.1.50 ó proxy.miproveedor.com" value="${escapeAttr(d.proxy_host || '')}">
        </label>
        <label>Puerto
          <input id="pxPort" type="number" placeholder="8080" value="${escapeAttr(d.proxy_port || '')}">
        </label>
        <div class="proxy-modal-row">
          <label class="proxy-half">Usuario (opcional)
            <input id="pxUser" type="text" value="${escapeAttr(d.proxy_user || '')}">
          </label>
          <label class="proxy-half">Clave (opcional)
            <input id="pxPass" type="password" value="">
          </label>
        </div>
        <p class="proxy-note">Nota: el proxy HTTP global de Android no admite usuario/clave; para proxies con autenticación se necesita una app de proxy en el teléfono.</p>
        <div id="pxStatus" class="proxy-status">${d.last_ip ? `Última IP conocida: <b>${escapeHtml(d.last_ip)}</b>` : 'IP externa sin comprobar.'}</div>
        <div class="proxy-modal-actions">
          <button class="btn-secondary" onclick="proxyCheckIp(${deviceId})">Ver IP actual</button>
          <button class="btn-danger" onclick="proxyApply(${deviceId}, false)">Quitar proxy</button>
          <button class="btn-primary" onclick="proxyApply(${deviceId}, true)">Guardar y aplicar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
}

async function proxyApply(deviceId, enabled) {
    const host = document.getElementById('pxHost')?.value.trim();
    const port = document.getElementById('pxPort')?.value.trim();
    const user = document.getElementById('pxUser')?.value.trim();
    const pass = document.getElementById('pxPass')?.value;
    if (enabled && (!host || !port)) { setProxyStatus('Host y puerto son obligatorios.', true); return; }
    try {
        const r = await apiFetch(`/devices/${deviceId}/proxy`, {
            method: 'PUT',
            body: JSON.stringify({ host, port: port ? Number(port) : null, user, pass, enabled }),
        });
        addLog(r.message || (enabled ? 'Proxy aplicado' : 'Proxy quitado'), 'info');
        setProxyStatus(r.message || 'Guardado.', false);
        await loadAll();
        setTimeout(() => document.getElementById('proxyModal')?.remove(), 900);
    } catch (e) {
        setProxyStatus('Error: ' + e.message, true);
    }
}

async function proxyCheckIp(deviceId) {
    setProxyStatus('Consultando IP en el dispositivo…', false);
    try {
        const r = await apiFetch(`/devices/${deviceId}/check-ip`, { method: 'POST', body: '{}' });
        const ext = r.data?.external_ip, loc = r.data?.local_ip, px = r.data?.proxy;
        setProxyStatus(`${ext ? `IP externa: <b>${escapeHtml(ext)}</b>` : (loc ? `IP local: <b>${escapeHtml(loc)}</b> (externa no disponible)` : 'IP no disponible')}${px ? ` · proxy activo: ${escapeHtml(px)}` : ''}`, false);
        await loadAll();
    } catch (e) {
        setProxyStatus('Error: ' + e.message, true);
    }
}

function setProxyStatus(html, isError) {
    const el = document.getElementById('pxStatus');
    if (el) { el.innerHTML = html; el.style.color = isError ? '#dc2626' : ''; }
}
