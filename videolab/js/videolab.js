// ============================================================
// VideoLab - Test Application for Device Automation Demo
// ============================================================

const API_BASE = window.location.origin;
let currentVideo = null;
let isPlaying = false;
let playTimer = null;
let liked = false;
let disliked = false;
let subscribed = false;
let commentCount = 0;

// Sample video database
const VIDEOS = [
    { id: 'v1', title: 'Introducción a MCP - Conceptos Básicos', channel: 'Tech Academy', views: '1.2K', date: 'hace 3 días', duration: '10:24', likes: 45, dislikes: 2 },
    { id: 'v2', title: 'Arquitectura de Microservicios', channel: 'Dev Masters', views: '890', date: 'hace 1 semana', duration: '15:30', likes: 67, dislikes: 3 },
    { id: 'v3', title: 'Automatización con Android Accessibility', channel: 'Mobile Lab', views: '2.1K', date: 'hace 2 días', duration: '8:45', likes: 120, dislikes: 5 },
    { id: 'v4', title: 'WebSocket en Tiempo Real', channel: 'Code Flow', views: '567', date: 'hace 5 días', duration: '12:10', likes: 34, dislikes: 1 },
    { id: 'v5', title: 'Kotlin para Principiantes', channel: 'Android Pro', views: '3.4K', date: 'hace 1 mes', duration: '20:15', likes: 200, dislikes: 8 },
    { id: 'v6', title: 'MySQL Optimization Tips', channel: 'Database Gurus', views: '1.8K', date: 'hace 4 días', duration: '9:30', likes: 89, dislikes: 4 },
    { id: 'v7', title: 'Redis Cache Strategy', channel: 'Backend World', views: '756', date: 'hace 2 semanas', duration: '14:20', likes: 45, dislikes: 2 },
    { id: 'v8', title: 'Docker para Desarrollo', channel: 'DevOps Daily', views: '4.2K', date: 'hace 3 semanas', duration: '18:45', likes: 310, dislikes: 12 },
];

let comments = [];

// ============================================================
// Initialization
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    renderVideoGrid();
    setupEventListeners();
    addLog('VideoLab inicializado');
});

function renderVideoGrid() {
    const grid = document.getElementById('videoGrid');
    grid.innerHTML = VIDEOS.map(video => `
        <div class="video-card" data-video-id="${video.id}" onclick="openVideo('${video.id}')">
            <div class="video-thumbnail">
                &#9654;
                <span class="video-duration">${video.duration}</span>
            </div>
            <div class="video-card-info">
                <div class="video-card-title">${video.title}</div>
                <div class="video-card-channel">${video.channel} | ${video.views} vistas</div>
            </div>
        </div>
    `).join('');
}

// ============================================================
// Navigation & Views
// ============================================================

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const view = document.getElementById(viewId);
    if (view) view.classList.add('active');
}

function openVideo(videoId) {
    currentVideo = VIDEOS.find(v => v.id === videoId);
    if (!currentVideo) return;

    document.getElementById('videoTitle').textContent = currentVideo.title;
    document.getElementById('videoChannel').textContent = currentVideo.channel;
    document.getElementById('videoViews').textContent = `${currentVideo.views} vistas`;
    document.getElementById('videoDate').textContent = currentVideo.date;
    document.getElementById('likeCount').textContent = currentVideo.likes;
    document.getElementById('dislikeCount').textContent = currentVideo.dislikes;

    liked = false; disliked = false; subscribed = false;
    updateEngagementButtons();

    renderComments();
    showView('playerView');
    addLog(`Abriendo video: ${currentVideo.title}`);
}

function goHome() {
    stopPlayback();
    currentVideo = null;
    showView('homeView');
    addLog('Volviendo al inicio');
}

// ============================================================
// Video Player Controls
// ============================================================

document.getElementById('playPauseBtn')?.addEventListener('click', () => {
    if (isPlaying) {
        pausePlayback();
    } else {
        startPlayback();
    }
});

function startPlayback() {
    isPlaying = true;
    document.getElementById('playPauseBtn').innerHTML = '&#10074;&#10074;';
    addLog('Reproduciendo video');
}

function pausePlayback() {
    isPlaying = false;
    document.getElementById('playPauseBtn').innerHTML = '&#9654;';
    addLog('Video pausado');
}

function stopPlayback() {
    isPlaying = false;
    if (playTimer) clearTimeout(playTimer);
    playTimer = null;
}

// ============================================================
// Engagement Actions
// ============================================================

document.getElementById('likeBtn')?.addEventListener('click', () => {
    liked = !liked;
    disliked = false;
    updateEngagementButtons();
    addLog(liked ? 'Like aplicado' : 'Like removido');
});

document.getElementById('dislikeBtn')?.addEventListener('click', () => {
    disliked = !disliked;
    liked = false;
    updateEngagementButtons();
    addLog(disliked ? 'Dislike aplicado' : 'Dislike removido');
});

document.getElementById('subscribeBtn')?.addEventListener('click', () => {
    subscribed = !subscribed;
    updateEngagementButtons();
    addLog(subscribed ? `Suscrito a ${currentVideo.channel}` : `No suscrito a ${currentVideo.channel}`);
});

function updateEngagementButtons() {
    const likeBtn = document.getElementById('likeBtn');
    const dislikeBtn = document.getElementById('dislikeBtn');
    const subscribeBtn = document.getElementById('subscribeBtn');

    likeBtn.classList.toggle('liked', liked);
    likeBtn.querySelector('.icon').textContent = liked ? '&#9829;' : '&#9825;';

    dislikeBtn.style.background = disliked ? 'rgba(62,166,255,0.2)' : '';
    dislikeBtn.style.color = disliked ? 'var(--accent-blue)' : '';

    subscribeBtn.classList.toggle('subscribed', subscribed);
    subscribeBtn.querySelector('.icon').textContent = subscribed ? '&#9670;' : '&#9734;';
}

// ============================================================
// Comments
// ============================================================

document.getElementById('publishCommentBtn')?.addEventListener('click', publishComment);
document.getElementById('commentInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') publishComment();
});

function publishComment() {
    const input = document.getElementById('commentInput');
    const text = input.value.trim();
    if (!text || !currentVideo) return;

    comments.unshift({ author: `Dispositivo ${Math.floor(Math.random() * 40) + 1}`, text, time: 'ahora' });
    commentCount++;
    document.getElementById('commentCount').textContent = commentCount;
    input.value = '';
    renderComments();
    addLog(`Comentario publicado: "${text.substring(0, 30)}..."`);

    // Send to backend via WebSocket or HTTP
    sendActionToBackend('comment', { videoId: currentVideo.id, text });
}

function renderComments() {
    const list = document.getElementById('commentsList');
    if (comments.length === 0) {
        list.innerHTML = '<p style="color: var(--text-secondary); padding: 12px;">Sé el primero en comentar</p>';
        return;
    }

    list.innerHTML = comments.map(c => `
        <div class="comment-item">
            <div class="comment-author">${c.author} <span style="font-weight:normal;color:var(--text-secondary)">- ${c.time}</span></div>
            <div class="comment-text">${escapeHtml(c.text)}</div>
        </div>
    `).join('');
}

// ============================================================
// Search
// ============================================================

document.getElementById('searchButton')?.addEventListener('click', performSearch);
document.getElementById('searchInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
});

function performSearch() {
    const query = document.getElementById('searchInput').value.trim().toLowerCase();
    if (!query) return;

    const results = VIDEOS.filter(v => v.title.toLowerCase().includes(query) || v.channel.toLowerCase().includes(query));

    document.getElementById('searchTitle').textContent = `Resultados para "${document.getElementById('searchInput').value}"`;

    const grid = document.getElementById('searchGrid');
    if (results.length === 0) {
        grid.innerHTML = '<p style="color: var(--text-secondary); padding: 24px;">No se encontraron resultados</p>';
    } else {
        grid.innerHTML = results.map(video => `
            <div class="video-card" data-video-id="${video.id}" onclick="openVideo('${video.id}')">
                <div class="video-thumbnail">&#9654;<span class="video-duration">${video.duration}</span></div>
                <div class="video-card-info">
                    <div class="video-card-title">${video.title}</div>
                    <div class="video-card-channel">${video.channel} | ${video.views} vistas</div>
                </div>
            </div>
        `).join('');
    }

    showView('searchResultsView');
    addLog(`Búsqueda: "${query}" - ${results.length} resultados`);
}

// ============================================================
// Backend Communication
// ============================================================

function sendActionToBackend(action, data) {
    fetch(`${API_BASE}/api/videolab/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data })
    }).catch(err => console.warn('Backend not available:', err));
}

// ============================================================
// Action Logger (Debug Panel)
// ============================================================

function addLog(message) {
    const entries = document.getElementById('logEntries');
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${escapeHtml(message)}`;
    entries.insertBefore(entry, entries.firstChild);

    // Keep only last 50 entries
    while (entries.children.length > 50) {
        entries.removeChild(entries.lastChild);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================
// Event Listeners Setup
// ============================================================

function setupEventListeners() {
    document.getElementById('backBtn')?.addEventListener('click', goHome);

    // Back button on search results
    const backFromSearch = document.createElement('button');
    backFromSearch.className = 'back-btn';
    backFromSearch.textContent = '&#8592; Volver';
    backFromSearch.addEventListener('click', () => showView('homeView'));
    const searchResultsView = document.getElementById('searchResultsView');
    if (searchResultsView && !document.querySelector('#searchResultsView .back-btn')) {
        searchResultsView.appendChild(backFromSearch);
    }

    // Simulate device info from URL params
    const urlParams = new URLSearchParams(window.location.search);
    const deviceId = urlParams.get('device');
    if (deviceId) {
        document.getElementById('deviceInfo').textContent = `Dispositivo: ${deviceId}`;
        addLog(`Iniciando en dispositivo: ${deviceId}`);
    }

    // Auto-play demo mode
    if (urlParams.get('demo') === 'true') {
        startDemoMode();
    }
}

// ============================================================
// Demo Mode (for automated testing)
// ============================================================

function startDemoMode() {
    addLog('Modo DEMO activado');

    setTimeout(() => {
        const firstVideo = VIDEOS[0];
        openVideo(firstVideo.id);

        setTimeout(() => {
            document.getElementById('playPauseBtn').click();
        }, 1500);

        setTimeout(() => {
            document.getElementById('likeBtn').click();
        }, 4000);

        setTimeout(() => {
            subscribed = true;
            updateEngagementButtons();
            addLog(`Suscrito a ${firstVideo.channel}`);
        }, 6000);

        setTimeout(() => {
            document.getElementById('commentInput').value = 'Prueba automática completada';
            publishComment();
        }, 8000);

        setTimeout(() => {
            addLog('Demo completo - Captura lista para reporte');
        }, 10000);
    }, 2000);
}
