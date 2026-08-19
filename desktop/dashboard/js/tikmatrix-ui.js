// Formulario de parámetros para la suite de scripts TikMatrix.
//
// Los scripts documentados en tikmatrix.com/docs/tutorial-scripts tienen entre 1 y
// 20 opciones cada uno. Encadenar customPrompt() para eso es inusable, así que aquí
// hay un modal que se construye solo a partir del esquema de cada script, igual que
// el diálogo "Start Script" de la app original.

const TIKMATRIX_SCRIPTS = {
    TIKMATRIX_LOGIN: {
        titulo: 'Login',
        descripcion: 'Entra con email+contraseña y, si no hay email, con usuario+contraseña. Para si detecta cuenta suspendida.',
        campos: [
            { k: 'email', t: 'text', label: 'Email', placeholder: 'prioritario sobre el usuario' },
            { k: 'username', t: 'text', label: 'Usuario (respaldo)', placeholder: '@usuario' },
            { k: 'password', t: 'text', label: 'Contraseña', placeholder: 'contraseña o contraseña:secreto_2fa' },
        ],
    },
    TIKMATRIX_SWITCH_ACCOUNT: {
        titulo: 'Switch Account',
        descripcion: 'Cambia a otra cuenta ya presente en el teléfono. Sin usuario, salta a la siguiente de la lista.',
        campos: [{ k: 'username', t: 'text', label: 'Usuario destino (opcional)', placeholder: '@usuario' }],
    },
    TIKMATRIX_PUBLISH_POST: {
        titulo: 'Post',
        descripcion: 'Publica desde la galería con pie de foto. Limpia la galería antes: se toma el primer elemento.',
        campos: [
            { k: 'method', t: 'select', label: 'Método', opciones: [['plus', 'Botón + '], ['sound', 'Usar sonido por búsqueda']], def: 'plus' },
            { k: 'sound_name', t: 'text', label: 'Sonido (método por sonido)', placeholder: 'nombre o URL' },
            { k: 'captions', t: 'lista', label: 'Pies de foto', placeholder: 'uno por línea; admite spintax {a|b}' },
            { k: 'caption_order', t: 'select', label: 'Orden', opciones: [['random', 'Aleatorio'], ['sequential', 'Secuencial']], def: 'random' },
            { k: 'upload_wait_sec', t: 'num', label: 'Espera de subida (s)', def: 15 },
            { k: 'save_draft', t: 'bool', label: 'Guardar solo como borrador' },
            { k: 'insert_emoji', t: 'bool', label: 'Insertar emoji' },
        ],
    },
    TIKMATRIX_FOLLOW_BACK: {
        titulo: 'Follow Back',
        descripcion: 'Devuelve el seguimiento a los seguidores que aún no sigues. Ignora los que ya salen como "Siguiendo".',
        campos: [{ k: 'max_follow', t: 'num', label: 'Máximo a seguir', def: 20 }],
    },
    TIKMATRIX_UNFOLLOW_ALL: {
        titulo: 'Unfollow All',
        descripcion: 'Recorre la lista de seguidos dejando de seguir, con confirmación cuando aparece.',
        campos: [{ k: 'limit', t: 'num', label: 'Máximo a dejar de seguir', def: 20 }],
    },
    TIKMATRIX_TEST_SCRIPT: {
        titulo: 'Test Script',
        descripcion: 'Comprobación sin efectos: app instalada, uiautomator, resolución e idioma. Úsalo antes de un script largo.',
        campos: [],
    },
    TIKMATRIX_ACCOUNT_WARMUP: {
        titulo: 'Account Warmup',
        descripcion: 'Navega el feed viendo, dando like, siguiendo, comentando y guardando, con probabilidades configurables.',
        campos: [
            { k: 'browse_mode', t: 'select', label: 'Modo de navegación', opciones: [['foryou', 'Para ti'], ['following', 'Siguiendo'], ['search', 'Buscar vídeos']], def: 'foryou' },
            { k: 'keywords', t: 'lista', label: 'Palabras clave (solo modo buscar)', placeholder: 'una por línea' },
            { k: 'view_min_sec', t: 'num', label: 'Ver desde (s)', def: 5 },
            { k: 'view_max_sec', t: 'num', label: 'Ver hasta (s)', def: 15 },
            { k: 'duration_min', t: 'num', label: 'Duración total (min)', def: 10 },
            { k: 'p_like', t: 'num', label: 'Probabilidad de like (0-1)', def: 0.3, step: 0.05 },
            { k: 'p_follow', t: 'num', label: 'Probabilidad de seguir (0-1)', def: 0.05, step: 0.05 },
            { k: 'p_comment', t: 'num', label: 'Probabilidad de comentar (0-1)', def: 0.05, step: 0.05 },
            { k: 'p_favorite', t: 'num', label: 'Probabilidad de guardar (0-1)', def: 0.05, step: 0.05 },
            { k: 'comments', t: 'lista', label: 'Comentarios candidatos', placeholder: 'uno por línea; admite spintax {a|b}' },
            { k: 'comment_order', t: 'select', label: 'Orden de comentarios', opciones: [['random', 'Aleatorio'], ['sequential', 'Secuencial']], def: 'random' },
            { k: 'insert_emoji', t: 'bool', label: 'Insertar emoji' },
        ],
    },
    TIKMATRIX_FILL_PROFILE: {
        titulo: 'Fill Profile',
        descripcion: 'Aplica apodo, nombre de usuario, biografía y avatar. Limpia la galería antes: se toma la primera foto.',
        campos: [
            { k: 'nicknames', t: 'lista', label: 'Apodos', placeholder: 'uno por línea' },
            { k: 'usernames', t: 'lista', label: 'Nombres de usuario', placeholder: 'uno por línea' },
            { k: 'bios', t: 'lista', label: 'Biografías', placeholder: 'una por línea' },
            { k: 'selection_order', t: 'select', label: 'Orden de selección', opciones: [['random', 'Aleatorio'], ['sequential', 'Secuencial']], def: 'random' },
            { k: 'set_avatar', t: 'bool', label: 'Poner avatar desde la galería' },
        ],
    },
    TIKMATRIX_MATCH_ACCOUNTS: {
        titulo: 'Match Account',
        descripcion: 'Lee las cuentas presentes en el dispositivo. Puede requerir varias pasadas.',
        campos: [],
    },
    TIKMATRIX_SCRAPE_USERS: {
        titulo: 'Scrape Users',
        descripcion: 'Recolecta usuarios por seguidores, seguidos o búsqueda. TikTok limita a ~50 por pasada.',
        campos: [
            { k: 'mode', t: 'select', label: 'Modo', opciones: [['followers', 'Por seguidores'], ['following', 'Por seguidos'], ['keyword', 'Por palabra clave']], def: 'followers' },
            { k: 'targets', t: 'lista', label: 'Cuentas objetivo', placeholder: 'una por línea (modos seguidores/seguidos)' },
            { k: 'keywords', t: 'lista', label: 'Palabras clave', placeholder: 'modo palabra clave' },
            { k: 'max_count', t: 'num', label: 'Máximo a extraer', def: 50 },
        ],
    },
    TIKMATRIX_FOLLOW_SUGGESTED: {
        titulo: 'Follow Suggested',
        descripcion: 'Sigue cuentas de la pestaña "Sugeridas" hasta el límite o hasta agotar sugerencias.',
        campos: [{ k: 'max_follow', t: 'num', label: 'Máximo a seguir', def: 20 }],
    },
    TIKMATRIX_MASS_DM: {
        titulo: 'Mass DM',
        descripcion: 'Envía DM a una lista de usuarios. Admite {username} y {sender_username}, y spintax {a|b}.',
        campos: [
            { k: 'targets', t: 'lista', label: 'Usuarios destino', placeholder: 'uno por línea' },
            { k: 'messages', t: 'lista', label: 'Mensajes', placeholder: 'uno por línea' },
            { k: 'messages_per_target', t: 'num', label: 'Mensajes por destino', def: 1 },
            { k: 'message_order', t: 'select', label: 'Orden', opciones: [['random', 'Aleatorio'], ['sequential', 'Secuencial']], def: 'random' },
            { k: 'open_method', t: 'select', label: 'Abrir perfil', opciones: [['direct', 'Directo'], ['search', 'Buscando']], def: 'direct' },
            { k: 'sender_username', t: 'text', label: 'Tu usuario (para {sender_username})' },
            { k: 'interval_min_sec', t: 'num', label: 'Intervalo mínimo (s)', def: 20 },
            { k: 'interval_max_sec', t: 'num', label: 'Intervalo máximo (s)', def: 60 },
            { k: 'insert_emoji', t: 'bool', label: 'Insertar emoji' },
        ],
    },
    TIKMATRIX_MASS_COMMENT: {
        titulo: 'Mass Comment',
        descripcion: 'Comenta una lista de publicaciones por URL.',
        campos: [
            { k: 'urls', t: 'lista', label: 'URLs de publicaciones', placeholder: 'una por línea' },
            { k: 'comments', t: 'lista', label: 'Comentarios', placeholder: 'uno por línea' },
            { k: 'comments_per_target', t: 'num', label: 'Comentarios por publicación', def: 1 },
            { k: 'comment_order', t: 'select', label: 'Orden', opciones: [['random', 'Aleatorio'], ['sequential', 'Secuencial']], def: 'random' },
            { k: 'device_label', t: 'text', label: 'Etiqueta de dispositivo (opcional)' },
            { k: 'interval_min_sec', t: 'num', label: 'Intervalo mínimo (s)', def: 20 },
            { k: 'interval_max_sec', t: 'num', label: 'Intervalo máximo (s)', def: 60 },
            { k: 'insert_emoji', t: 'bool', label: 'Insertar emoji' },
        ],
    },
    TIKMATRIX_BOOST_POSTS: {
        titulo: 'Boost Posts',
        descripcion: 'Interactúa con una lista de publicaciones: ver, like, guardar, repost, compartir y comentar.',
        campos: [
            { k: 'urls', t: 'lista', label: 'URLs de publicaciones', placeholder: 'una por línea' },
            { k: 'repeat', t: 'num', label: 'Repeticiones', def: 1 },
            { k: 'view_min_sec', t: 'num', label: 'Ver desde (s)', def: 5 },
            { k: 'view_max_sec', t: 'num', label: 'Ver hasta (s)', def: 20 },
            { k: 'like', t: 'bool', label: 'Dar like', def: true },
            { k: 'favorite', t: 'bool', label: 'Guardar' },
            { k: 'repost', t: 'bool', label: 'Repost' },
            { k: 'share', t: 'bool', label: 'Compartir' },
            { k: 'comment', t: 'bool', label: 'Comentar' },
            { k: 'comments', t: 'lista', label: 'Comentarios', placeholder: 'uno por línea' },
        ],
    },
    TIKMATRIX_BOOST_LIVES: {
        titulo: 'Boost Lives',
        descripcion: 'Entra a los directos indicados, ve, da likes por intervalo y comenta.',
        campos: [
            { k: 'usernames', t: 'lista', label: 'Streamers', placeholder: 'uno por línea' },
            { k: 'enter_method', t: 'select', label: 'Entrar', opciones: [['direct', 'Directo'], ['search', 'Buscando']], def: 'direct' },
            { k: 'view_duration_sec', t: 'num', label: 'Ver (s)', def: 120 },
            { k: 'like_interval_sec', t: 'num', label: 'Intervalo de likes (s)', def: 15 },
            { k: 'like_tap_count', t: 'num', label: 'Toques por tanda', def: 5 },
            { k: 'comment_interval_sec', t: 'num', label: 'Intervalo de comentarios (s)', def: 45 },
            { k: 'comments_per_account', t: 'num', label: 'Comentarios por cuenta', def: 3 },
            { k: 'comments', t: 'lista', label: 'Comentarios', placeholder: 'uno por línea' },
            { k: 'join_fan_club', t: 'bool', label: 'Unirse al club de fans' },
            { k: 'check_in_daily', t: 'bool', label: 'Registro diario' },
        ],
    },
    TIKMATRIX_BOOST_COMMENTS: {
        titulo: 'Boost Comments',
        descripcion: 'Da like y responde a comentarios concretos por URL.',
        campos: [
            { k: 'urls', t: 'lista', label: 'URLs de comentarios', placeholder: 'una por línea' },
            { k: 'like', t: 'bool', label: 'Dar like al comentario', def: true },
            { k: 'reply', t: 'bool', label: 'Responder' },
            { k: 'replies', t: 'lista', label: 'Respuestas', placeholder: 'una por línea' },
            { k: 'reply_order', t: 'select', label: 'Orden', opciones: [['random', 'Aleatorio'], ['sequential', 'Secuencial']], def: 'random' },
            { k: 'interval_sec', t: 'num', label: 'Intervalo (s)', def: 20 },
            { k: 'insert_emoji', t: 'bool', label: 'Insertar emoji' },
        ],
    },
    TIKMATRIX_DELETE_POSTS: {
        titulo: 'Delete Post',
        descripcion: 'Borra publicaciones por debajo de un umbral de vistas. Irreversible.',
        peligro: true,
        campos: [
            { k: 'max_views', t: 'num', label: 'Vistas máximas (umbral)', def: 100 },
            { k: 'max_posts', t: 'num', label: 'Máximo a procesar (0 = todas)', def: 0 },
        ],
    },
    TIKMATRIX_PRIVACY_SETTINGS: {
        titulo: 'Privacy Settings',
        descripcion: 'Cambia quién puede ver las publicaciones por debajo de un umbral de vistas. No se puede deshacer desde el script.',
        peligro: true,
        campos: [
            { k: 'max_views', t: 'num', label: 'Vistas máximas (umbral)', def: 100 },
            { k: 'max_posts', t: 'num', label: 'Máximo a procesar (0 = todas)', def: 0 },
            { k: 'who_can_watch', t: 'select', label: 'Quién puede verlo', opciones: [['friends', 'Amigos'], ['only_me', 'Solo yo'], ['everyone', 'Todos']], def: 'friends' },
            { k: 'allow_comments', t: 'bool', label: 'Permitir comentarios', def: true },
            { k: 'allow_reuse', t: 'bool', label: 'Permitir reutilizar', def: true },
        ],
    },
    TIKMATRIX_SUPER_MARKETING: {
        titulo: 'Super Marketing',
        descripcion: 'Cola única: seguir/dejar de seguir, DM, interacción con publicaciones y comentarios sobre cada objetivo.',
        campos: [
            { k: 'data_source', t: 'select', label: 'Origen de datos', opciones: [['usernames', 'Lista de usuarios'], ['urls', 'Lista de URLs']], def: 'usernames' },
            { k: 'targets', t: 'lista', label: 'Objetivos', placeholder: 'uno por línea' },
            { k: 'consumption_limit', t: 'num', label: 'Límite por tarea (0 = sin límite)', def: 0 },
            { k: 'follow', t: 'bool', label: 'Seguir' },
            { k: 'unfollow', t: 'bool', label: 'Dejar de seguir' },
            { k: 'send_dm', t: 'bool', label: 'Enviar DM' },
            { k: 'messages', t: 'lista', label: 'Mensajes DM', placeholder: 'uno por línea' },
            { k: 'sender_username', t: 'text', label: 'Tu usuario (para {sender_username})' },
            { k: 'skip_posts', t: 'num', label: 'Saltar publicaciones (0-8)', def: 0 },
            { k: 'max_posts', t: 'num', label: 'Publicaciones a procesar (1-50)', def: 3 },
            { k: 'view_min_sec', t: 'num', label: 'Ver desde (s)', def: 3 },
            { k: 'view_max_sec', t: 'num', label: 'Ver hasta (s)', def: 20 },
            { k: 'like', t: 'bool', label: 'Like' },
            { k: 'favorite', t: 'bool', label: 'Guardar' },
            { k: 'repost', t: 'bool', label: 'Repost' },
            { k: 'share', t: 'bool', label: 'Compartir' },
            { k: 'comment', t: 'bool', label: 'Comentar' },
            { k: 'comments', t: 'lista', label: 'Comentarios', placeholder: 'uno por línea' },
            { k: 'template_order', t: 'select', label: 'Orden de plantillas', opciones: [['random', 'Aleatorio'], ['sequential', 'Secuencial']], def: 'random' },
            { k: 'interval_min_min', t: 'num', label: 'Intervalo mínimo (min)', def: 0 },
            { k: 'interval_max_min', t: 'num', label: 'Intervalo máximo (min)', def: 0 },
            { k: 'insert_emoji', t: 'bool', label: 'Insertar emoji' },
        ],
    },
    TIKMATRIX_LIST_PACKAGES: {
        titulo: 'App Packages',
        descripcion: 'Comprueba qué apps objetivo hay en el dispositivo, incluidos clones por prefijo.',
        campos: [
            { k: 'tiktok', t: 'bool', label: 'TikTok Global (com.zhiliaoapp.musically)', def: true },
            { k: 'tiktok_asia', t: 'bool', label: 'TikTok Asia (com.ss.android.ugc.trill)' },
            { k: 'instagram', t: 'bool', label: 'Instagram', def: true },
            { k: 'clone_prefix', t: 'text', label: 'Prefijo de clones', placeholder: 'ej. com.miclon.' },
        ],
    },
};

// Bloque que TikMatrix repite en el diálogo de TODOS sus scripts y que sus
// páginas de documentación no recogen: rotación de proxy, cierre de la app al
// terminar, selección de paquete con prefijo de clones e intervalo de tarea.
const CAMPOS_COMUNES = [
    { k: 'rotate_proxy', t: 'bool', label: 'Rotar proxy antes de la tarea' },
    { k: 'close_app_after', t: 'bool', label: 'Cerrar la app al terminar', def: true },
    { k: 'pkg_tiktok', t: 'bool', label: 'TikTok Global (com.zhiliaoapp.musically)', def: true },
    { k: 'pkg_tiktok_asia', t: 'bool', label: 'TikTok Asia (com.ss.android.ugc.trill)' },
    { k: 'pkg_instagram', t: 'bool', label: 'Instagram (com.instagram.android)' },
    { k: 'clone_prefix', t: 'text', label: 'Prefijo de apps clonadas', placeholder: 'ej. com.tiktok.clone.' },
    { k: 'task_interval_min', t: 'num', label: 'Intervalo de tarea, mínimo (min)', def: 0 },
    { k: 'task_interval_max', t: 'num', label: 'Intervalo de tarea, máximo (min)', def: 0 },
];

// Avisos que la app original muestra en scripts concretos.
const AVISOS = {
    TIKMATRIX_MATCH_ACCOUNTS: 'Antes de emparejar cuentas, inicia sesión en TikTok en el teléfono. El sistema reconoce las cuentas ya conectadas para el cambio entre cuentas.',
    TIKMATRIX_LOGIN: 'TikTok no automatiza el login por completo: puede pedir verificación manual. El script se detiene si detecta cuenta suspendida.',
    TIKMATRIX_FILL_PROFILE: 'Limpia la galería antes de ejecutarlo: se toma la primera foto como avatar.',
    TIKMATRIX_SCRAPE_USERS: 'TikTok limita la lista visible: se recuperan unos 50 registros por pasada.',
};

let scriptActual = null;

function renderCampos(campos) {
    return campos.map(c => {
        const id = `tmf_${c.k}`;
        if (c.t === 'bool') {
            return `<label class="tm-campo tm-check"><input type="checkbox" id="${id}" ${c.def ? 'checked' : ''}> <span>${c.label}</span></label>`;
        }
        if (c.t === 'select') {
            const ops = c.opciones.map(([v, n]) => `<option value="${v}" ${v === c.def ? 'selected' : ''}>${n}</option>`).join('');
            return `<label class="tm-campo"><span>${c.label}</span><select id="${id}" class="modal-input">${ops}</select></label>`;
        }
        if (c.t === 'lista') {
            return `<label class="tm-campo"><span>${c.label}</span><textarea id="${id}" class="modal-input" rows="3" placeholder="${c.placeholder || ''}"></textarea></label>`;
        }
        const tipo = c.t === 'num' ? 'number' : 'text';
        const step = c.step ? ` step="${c.step}"` : '';
        return `<label class="tm-campo"><span>${c.label}</span><input type="${tipo}"${step} id="${id}" class="modal-input" value="${c.def ?? ''}" placeholder="${c.placeholder || ''}"></label>`;
    }).join('');
}

function abrirScriptTikMatrix(comando) {
    const def = TIKMATRIX_SCRIPTS[comando];
    if (!def) return;
    scriptActual = comando;

    const propios = renderCampos(def.campos);
    // List Packages ES el selector de paquete, así que no se le añade encima.
    const comunes = comando === 'TIKMATRIX_LIST_PACKAGES' ? '' : renderCampos(CAMPOS_COMUNES);
    const seleccionados = selectedDeviceIds.size || devices.filter(d => ['online', 'busy'].includes(d.status)).length;

    document.getElementById('tmScriptTitle').textContent = def.titulo;
    document.getElementById('tmScriptDesc').textContent = def.descripcion;
    document.getElementById('tmScriptFields').innerHTML =
        (propios || '<p class="muted-text tm-ancho">Este script no tiene parámetros propios.</p>') +
        (comunes ? `<div class="tm-grupo">Opciones comunes</div>${comunes}` : '');
    document.getElementById('tmScriptTargets').textContent =
        `Se ejecutará en ${seleccionados} dispositivo(s)${selectedDeviceIds.size ? ' seleccionados' : ' en línea'}.`;

    const nota = document.getElementById('tmScriptNote');
    nota.textContent = AVISOS[comando] || '';
    nota.hidden = !AVISOS[comando];

    const aviso = document.getElementById('tmScriptWarn');
    aviso.hidden = !def.peligro;
    document.getElementById('tmScriptModal').hidden = false;
}

function cerrarScriptTikMatrix() {
    document.getElementById('tmScriptModal').hidden = true;
    scriptActual = null;
}

function lanzarScriptTikMatrix() {
    const comando = scriptActual;
    const def = TIKMATRIX_SCRIPTS[comando];
    if (!def) return;

    const campos = comando === 'TIKMATRIX_LIST_PACKAGES' ? def.campos : [...def.campos, ...CAMPOS_COMUNES];
    const params = {};
    for (const c of campos) {
        const el = document.getElementById(`tmf_${c.k}`);
        if (!el) continue;
        if (c.t === 'bool') { params[c.k] = el.checked; continue; }
        const v = el.value;
        if (c.t === 'num') {
            const n = parseFloat(v);
            // Sin este filtro, un campo vacío mandaba NaN y el script lo tomaba
            // como 0 (duración cero, cero repeticiones…).
            if (Number.isFinite(n)) params[c.k] = n;
            continue;
        }
        if (c.t === 'lista') {
            const lista = v.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            if (lista.length) params[c.k] = lista;
            continue;
        }
        if (v && v.trim()) params[c.k] = v.trim();
    }

    cerrarScriptTikMatrix();
    quickAction(comando, params);
}

// Stop Task no es un comando del teléfono: cancela en el servidor lo que haya en
// cola o corriendo y luego cierra la app en cada dispositivo, para que un script
// interrumpido no deje el móvil a medias en una pantalla cualquiera.
async function detenerTareasTikMatrix() {
    let ids = [...selectedDeviceIds];
    if (!ids.length) ids = devices.filter(d => ['online', 'busy'].includes(d.status)).map(d => d.id);
    if (!ids.length) { alert('No hay dispositivos a los que parar tareas.'); return; }

    const paquete = document.getElementById('tmf_package_name')?.value || 'com.zhiliaoapp.musically';
    try {
        const r = await apiFetch('/tasks/stop', {
            method: 'POST',
            body: JSON.stringify({ device_ids: ids, package_name: paquete }),
        });
        addLog(r.message || 'Tareas detenidas', 'warning');
        loadAll();
    } catch (e) {
        addLog(`Error al detener tareas: ${e.message}`, 'error');
    }
}

window.abrirScriptTikMatrix = abrirScriptTikMatrix;
window.cerrarScriptTikMatrix = cerrarScriptTikMatrix;
window.lanzarScriptTikMatrix = lanzarScriptTikMatrix;
window.detenerTareasTikMatrix = detenerTareasTikMatrix;
