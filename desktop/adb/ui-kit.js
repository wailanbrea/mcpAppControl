// Primitivas compartidas por las suites de scripts (TikTok, Spotify, Twitch).
//
// Aquí vive todo lo que no depende de la app concreta: leer el árbol de la
// pantalla, localizar controles por texto o content-desc, pulsar, deslizar,
// escribir, y las utilidades de plantillas (spintax, orden, emoji).
//
// Las etiquetas de cada aplicación NO están aquí: cada suite trae las suyas,
// porque "Seguir" en TikTok y "Reproducir" en Spotify no tienen nada que ver.

// Diálogos del sistema y de permisos: esto sí es común a cualquier app Android.
const DESCARTAR = [
  'Ahora no', 'Not now', 'Cancelar', 'Cancel', 'Entendido', 'Got it',
  'OK', 'Aceptar', 'Cerrar', 'Close', 'Permitir', 'Allow', 'Más tarde', 'Later',
];

const EMOJIS = ['🔥', '😍', '👏', '💯', '❤️', '😂', '🙌', '✨', '👀', '🤩'];

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Spintax: "Hola {mundo|gente}" -> una variante al azar. Admite anidado.
function spin(text) {
  let out = String(text ?? '');
  let guard = 0;
  while (/\{[^{}]*\|[^{}]*\}/.test(out) && guard++ < 50) {
    out = out.replace(/\{([^{}]*\|[^{}]*)\}/, (_, body) => {
      const parts = body.split('|');
      return parts[Math.floor(Math.random() * parts.length)];
    });
  }
  return out;
}

// Una lista puede llegar como array o como texto multilínea desde el panel.
function toList(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  return String(value ?? '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
}

function pickTemplate(list, order, index) {
  if (!list.length) return '';
  if (order === 'sequential') return list[index % list.length];
  return list[Math.floor(Math.random() * list.length)];
}

function fillVars(text, vars) {
  return String(text ?? '')
    .replace(/\{username\}/gi, vars.username || '')
    .replace(/\{sender_username\}/gi, vars.sender_username || '');
}

function decorate(text, { insert_emoji } = {}) {
  const t = spin(text);
  if (!insert_emoji) return t;
  return `${t} ${EMOJIS[Math.floor(Math.random() * EMOJIS.length)]}`;
}

// "1.2K", "3,4 M", "890" -> número.
function parseCount(raw) {
  const m = String(raw ?? '').replace(/\s+/g, '').match(/([\d.,]+)\s*([KMB])?/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, '.'));
  if (!Number.isFinite(n)) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1;
  return Math.round(n * mult);
}

// "3:45" -> 225 segundos. Spotify muestra así la duración de las pistas.
function parseDuracion(raw) {
  const m = String(raw ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return m[3] ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
}

function makeUi(ctx, serial) {
  const { shell, sleep, dumpUi, live, HJ, HD } = ctx;

  // Espacio de coordenadas real, deducido de los límites del volcado.
  //
  // No se puede confiar en el tamaño registrado del dispositivo: en un S21 Ultra
  // `live` guarda 1080x2400 mientras que la pantalla —y por tanto lo que devuelve
  // el árbol de UI y lo que espera `input tap`— es 1440x3200. Con el valor
  // equivocado, todo gesto por porcentaje cae a 3/4 de donde debería.
  let espacio = null;

  const size = () => {
    if (espacio) return espacio;
    const d = live.get(serial);
    return { w: d?.size?.w || 1080, h: d?.size?.h || 2400 };
  };

  const tapXY = async (x, y) => {
    const j = HJ(Math.round(x), Math.round(y));
    await shell(serial, ['input', 'tap', String(j.x), String(j.y)]);
  };

  const swipe = async (x1, y1, x2, y2, ms) => {
    await shell(serial, ['input', 'swipe', String(Math.round(x1)), String(Math.round(y1)),
      String(Math.round(x2)), String(Math.round(y2)), String(HD(ms))]);
  };

  const back = () => shell(serial, ['input', 'keyevent', '4']).catch(() => {});
  const enter = () => shell(serial, ['input', 'keyevent', '66']).catch(() => {});

  // Devuelve TODOS los nodos, no solo el primero: recorrer listas lo necesita.
  const nodes = (xml) => {
    const out = [];
    const re = /<node\b([^>]*)>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const attrs = m[1];
      const g = (name) => {
        const mm = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
        return mm ? mm[1] : '';
      };
      const b = attrs.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
      out.push({
        text: g('text'),
        desc: g('content-desc'),
        id: g('resource-id'),
        clase: g('class'),
        clickable: g('clickable') === 'true',
        selected: g('selected') === 'true',
        checked: g('checked') === 'true',
        bounds: b ? { x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4] } : null,
        cx: b ? Math.round((+b[1] + +b[3]) / 2) : 0,
        cy: b ? Math.round((+b[2] + +b[4]) / 2) : 0,
      });
    }
    return out;
  };

  const dump = async () => {
    const ns = nodes(await dumpUi(serial).catch(() => ''));
    // El nodo raíz abarca toda la pantalla: sus límites son el espacio de
    // coordenadas auténtico, el mismo que espera `input tap`.
    let maxX = 0, maxY = 0;
    for (const n of ns) {
      if (!n.bounds) continue;
      if (n.bounds.x2 > maxX) maxX = n.bounds.x2;
      if (n.bounds.y2 > maxY) maxY = n.bounds.y2;
    }
    if (maxX > 200 && maxY > 200) espacio = { w: maxX, h: maxY };
    return ns;
  };

  // Comparación deliberadamente estricta con las etiquetas cortas: con un
  // `includes` suelto, "Ad" casaba con "añadir", "cargando" o "descargar" y el
  // recorrido del feed daba por anuncio absolutamente todo.
  const matches = (n, labels) => labels.some(l => {
    const needle = String(l).toLowerCase().trim();
    const t = (n.text || '').toLowerCase().trim();
    const d = (n.desc || '').toLowerCase().trim();
    if (!needle) return false;
    if (t === needle || d === needle) return true;
    if (needle.length < 5) return false;
    return t.startsWith(needle) || d.startsWith(needle) || d.includes(needle);
  });

  const findAll = (ns, labels) => ns.filter(n => n.bounds && matches(n, labels));
  const find = (ns, labels) => findAll(ns, labels)[0] || null;

  const tapAny = async (labels, { ns } = {}) => {
    const list = ns || await dump();
    const n = find(list, labels);
    if (!n) return false;
    await tapXY(n.cx, n.cy);
    return true;
  };

  const dismissPopups = async () => {
    const ns = await dump();
    const n = find(ns, DESCARTAR);
    if (!n) return false;
    await tapXY(n.cx, n.cy);
    await sleep(600);
    return true;
  };

  // Texto vía el IME del agente si responde; si no, `input text`.
  const type = async (value) => {
    const v = String(value ?? '');
    const ok = await shell(serial, ['am', 'broadcast', '-a', 'ADB_SET_TEXT', '--es', 'text', v])
      .then(out => /result=-1|Broadcast completed/i.test(String(out || '')))
      .catch(() => false);
    if (!ok) await shell(serial, ['input', 'text', v.replace(/ /g, '%s')]).catch(() => {});
  };

  const openApp = async (pkg) => {
    await shell(serial, ['monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']).catch(() => {});
    await sleep(3000);
    await dismissPopups();
  };

  const openUrl = async (url, pkg) => {
    const args = ['am', 'start', '-a', 'android.intent.action.VIEW', '-d', String(url)];
    if (pkg) args.push(pkg);
    await shell(serial, args).catch(() => {});
    await sleep(3500);
    await dismissPopups();
  };

  const scrollList = async () => {
    const { w, h } = size();
    await swipe(w * 0.5, h * 0.75, w * 0.5, h * 0.35, randInt(240, 400));
    await sleep(randInt(700, 1200));
  };

  return { size, tapXY, swipe, back, enter, nodes, dump, find, findAll, matches,
           tapAny, dismissPopups, type, openApp, openUrl, scrollList };
}

module.exports = {
  DESCARTAR, EMOJIS, randInt, spin, toList, pickTemplate, fillVars, decorate,
  parseCount, parseDuracion, makeUi,
};
