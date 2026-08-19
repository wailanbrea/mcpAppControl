// Suite de scripts para Spotify, con la misma forma que la de TikMatrix.
//
// Las etiquetas NO son inventadas: salen del volcado real de la app en un
// SM-G998U con el sistema en español. De ahí vienen cosas como "Pestaña 1 de 4"
// (las tabs se identifican por content-desc, no por texto) o "Barra Estás
// escuchando" para el reproductor minimizado.
//
// Aviso importante para quien mantenga esto: automatizar reproducciones infla
// contadores que se traducen en regalías. Spotify lo trata como manipulación de
// streams y puede retirar temas y retener pagos.

const K = require('./ui-kit');
const { randInt, toList, pickTemplate, spin, parseDuracion } = K;

// Etiquetas observadas en la app (ES) más su equivalente en inglés.
const L = {
  inicio:      ['Inicio', 'Home'],
  buscar:      ['Buscar', 'Search'],
  biblioteca:  ['Tu biblioteca', 'Your Library'],
  crear:       ['Crear', 'Create'],

  reproducir:  ['Reproducir', 'Play'],
  pausar:      ['Pausar', 'Pause'],
  siguiente:   ['Saltar al siguiente', 'Skip to next', 'Siguiente', 'Next'],
  anterior:    ['Saltar al anterior', 'Skip to previous', 'Anterior', 'Previous'],
  aleatorio:   ['Reproducción aleatoria', 'Shuffle', 'Activar reproducción aleatoria', 'Enable shuffle'],
  repetir:     ['Repetir', 'Repeat'],

  meGusta:     ['Me gusta', 'Añadir a Tus me gusta', 'Agregar a Tus me gusta', 'Save to Your Library', 'Like'],
  yaGuardado:  ['Elemento agregado', 'Quitar de Tus me gusta', 'Remove from Your Library', 'Saved'],
  agregarA:    ['Agregar a', 'Añadir a', 'Add to playlist', 'Agregar a playlist'],
  masOpciones: ['Más opciones', 'More options', 'Más', 'More'],
  seguir:      ['Seguir', 'Follow'],
  siguiendo:   ['Siguiendo', 'Following'],

  barraRepro:  ['Barra Estás escuchando', 'Now playing bar'],
  pistaActual: ['Pista en reproducción', 'Track now playing'],
  perfil:      ['Ir a perfil y configuración', 'Go to profile and settings', 'Perfil', 'Profile'],
  tusMeGusta:  ['Tus me gusta', 'Liked Songs'],

  guardar:     ['Guardar', 'Save', 'Listo', 'Done', 'Confirmar', 'Confirm', 'Crear', 'Create'],
  cancion:     ['Canciones', 'Songs', 'Canción', 'Song'],
  artistas:    ['Artistas', 'Artists'],
};

const PAQUETE = 'com.spotify.music';

const COMMANDS = new Set([
  'SPOTIFY_LOGIN',
  'SPOTIFY_MATCH_ACCOUNT',
  'SPOTIFY_PLAY_URL',
  'SPOTIFY_SEARCH_PLAY',
  'SPOTIFY_STREAM_CAMPAIGN',
  'SPOTIFY_WARMUP',
  'SPOTIFY_FOLLOW_ARTIST',
  'SPOTIFY_SAVE_TRACK',
  'SPOTIFY_CREATE_PLAYLIST',
  'SPOTIFY_ADD_TO_PLAYLIST',
  'SPOTIFY_PLAYBACK',
  'SPOTIFY_TEST_SCRIPT',
]);

function handles(command) { return COMMANDS.has(command); }

function pkgFor(p) { return String(p.package_name || PAQUETE); }

// Normaliza un enlace de Spotify. Acepta URL web, URI spotify: o un id suelto.
function normalizarEnlace(entrada, tipo = 'track') {
  const s = String(entrada || '').trim();
  if (!s) return '';
  if (s.startsWith('spotify:')) return s;
  if (/^https?:\/\//i.test(s)) return s.split('?')[0];
  if (/^[A-Za-z0-9]{22}$/.test(s)) return `spotify:${tipo}:${s}`;
  return s;
}

// ------------------------------------------------------------------ helpers

// Lee la pista que suena ahora mismo del reproductor minimizado.
async function pistaActual(ui) {
  const ns = await ui.dump();
  const barra = ui.find(ns, L.barraRepro);
  if (!barra) return null;
  // La barra anuncia "Barra Estás escuchando" y a su lado van título y artista.
  const cercanos = ns.filter(n => n.bounds && barra.bounds &&
    n.bounds.y1 >= barra.bounds.y1 - 10 && n.bounds.y2 <= barra.bounds.y2 + 10 &&
    (n.text || n.desc));
  const textos = cercanos.map(n => n.text || n.desc).filter(t =>
    t && !/barra|pista en reproducci|reproducir|pausar|conectar/i.test(t));
  return textos.length ? { titulo: textos[0], artista: textos[1] || '' } : null;
}

async function estaReproduciendo(ui) {
  const ns = await ui.dump();
  // Si el botón visible es "Pausar", está sonando.
  return !!ui.find(ns, L.pausar);
}

async function asegurarReproduccion(ui, sleep) {
  if (await estaReproduciendo(ui)) return true;
  if (await ui.tapAny(L.reproducir)) { await sleep(1500); return await estaReproduciendo(ui); }
  return false;
}

// ------------------------------------------------------------------ scripts

async function login(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const usuario = String(p.email || p.username || '').trim();
  const password = String(p.password || '');
  if (!usuario || !password) return { success: false, message: 'Faltan credenciales' };

  await ui.openApp(pkg);
  await sleep(2000);

  await ui.tapAny(['Iniciar sesión', 'Log in', 'Continuar con correo', 'Continue with email']);
  await sleep(2500);

  const ns = await ui.dump();
  const campos = ns.filter(n => n.bounds && /EditText/i.test(n.clase));
  if (!campos.length) return { success: false, message: 'No se encontró el formulario de acceso' };

  await ui.tapXY(campos[0].cx, campos[0].cy);
  await sleep(700);
  await ui.type(usuario);
  await sleep(500);

  const ns2 = await ui.dump();
  const campos2 = ns2.filter(n => n.bounds && /EditText/i.test(n.clase));
  const campoPass = campos2[1] || campos2[0];
  if (campoPass) { await ui.tapXY(campoPass.cx, campoPass.cy); await sleep(700); await ui.type(password); }

  await sleep(500);
  if (!await ui.tapAny(['Iniciar sesión', 'Log in', 'Acceder'])) await ui.enter();
  await sleep(7000);
  await ui.dismissPopups();

  const final = await ui.dump();
  const dentro = !!ui.find(final, L.inicio) || !!ui.find(final, L.biblioteca);
  return {
    success: dentro,
    message: dentro ? `Sesión iniciada con ${usuario}` : 'No se pudo confirmar el acceso (Spotify puede pedir verificación)',
    data: { usuario },
  };
}

async function matchAccount(ctx, serial, p, ui) {
  const { sleep } = ctx;
  await ui.openApp(pkgFor(p));
  if (!await ui.tapAny(L.perfil)) return { success: false, message: 'No se encontró el acceso al perfil' };
  await sleep(2500);

  const ns = await ui.dump();
  const candidatos = ns
    .map(n => (n.text || '').trim())
    .filter(t => t && t.length > 1 && t.length < 40 &&
      !/configuraci|settings|ver perfil|view profile|seguidor|following|premium|cuenta/i.test(t));

  const nombre = candidatos[0] || '';
  await ui.back();
  return {
    success: !!nombre,
    message: nombre ? `Cuenta de Spotify en el dispositivo: ${nombre}` : 'No se pudo leer la cuenta',
    data: { cuenta: nombre },
  };
}

// Abre un enlace y reproduce. Es la base de las campañas.
async function playUrl(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const enlace = normalizarEnlace(p.url ?? p.track, p.tipo || 'track');
  if (!enlace) return { success: false, message: 'Falta el enlace de Spotify' };

  const segundos = Number(p.play_seconds ?? 45);
  await ui.openUrl(enlace, pkg);
  await sleep(2500);

  if (p.shuffle) { await ui.tapAny(L.aleatorio); await sleep(900); }

  const sonando = await asegurarReproduccion(ui, sleep);
  if (!sonando) return { success: false, message: 'No se pudo iniciar la reproducción', data: { enlace } };

  const pista = await pistaActual(ui);
  await sleep(segundos * 1000);

  const seguiaSonando = await estaReproduciendo(ui);
  if (p.pause_after) { await ui.tapAny(L.pausar); }

  return {
    success: true,
    message: `Reproducido ${segundos}s${pista ? `: ${pista.titulo} — ${pista.artista}` : ''}`,
    data: { enlace, segundos, pista, seguia_sonando: seguiaSonando },
  };
}

async function searchPlay(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const consulta = String(p.query || '').trim();
  if (!consulta) return { success: false, message: 'Falta la consulta de búsqueda' };
  const segundos = Number(p.play_seconds ?? 45);

  await ui.openApp(pkg);
  if (!await ui.tapAny(L.buscar)) return { success: false, message: 'No se encontró la pestaña Buscar' };
  await sleep(1800);

  // El campo de búsqueda hay que enfocarlo antes de escribir.
  const ns = await ui.dump();
  const campo = ns.find(n => n.bounds && /EditText/i.test(n.clase))
             || ui.find(ns, ['¿Qué quieres escuchar?', 'What do you want to listen to?', 'Buscar', 'Search']);
  if (campo) { await ui.tapXY(campo.cx, campo.cy); await sleep(900); }

  await ui.type(consulta);
  await sleep(500);
  await ui.enter();
  await sleep(3000);

  if (p.solo_canciones !== false) { await ui.tapAny(L.cancion); await sleep(1800); }

  // Primer resultado: el nodo pulsable más alto por debajo de la barra de búsqueda.
  const res = await ui.dump();
  const { h } = ui.size();
  const primero = res.filter(n => n.bounds && n.clickable && n.bounds.y1 > h * 0.20)
                     .sort((a, b) => a.bounds.y1 - b.bounds.y1)[0];
  if (!primero) return { success: false, message: `Sin resultados para "${consulta}"` };

  await ui.tapXY(primero.cx, primero.cy);
  await sleep(3000);
  const sonando = await asegurarReproduccion(ui, sleep);
  if (!sonando) return { success: false, message: 'Se abrió el resultado pero no arrancó la reproducción' };

  const pista = await pistaActual(ui);
  await sleep(segundos * 1000);
  return {
    success: true,
    message: `"${consulta}" reproducido ${segundos}s${pista ? `: ${pista.titulo}` : ''}`,
    data: { consulta, pista, segundos },
  };
}

// Campaña de reproducción: recorre una lista de enlaces, N pasadas, con huecos
// aleatorios entre reproducciones.
async function streamCampaign(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const enlaces = toList(p.urls ?? p.tracks).map(u => normalizarEnlace(u, p.tipo || 'track'));
  if (!enlaces.length) return { success: false, message: 'Falta la lista de enlaces' };

  const pasadas = Number(p.repeat ?? 1);
  const [sMin, sMax] = [Number(p.play_min_sec ?? 35), Number(p.play_max_sec ?? 70)];
  const [gMin, gMax] = [Number(p.gap_min_sec ?? 3), Number(p.gap_max_sec ?? 12)];
  const orden = p.order || 'sequential';

  const stats = { reproducciones: 0, fallidas: 0, segundos: 0 };
  const detalle = [];

  for (let r = 0; r < pasadas; r++) {
    const lista = orden === 'random' ? [...enlaces].sort(() => Math.random() - 0.5) : enlaces;
    for (const enlace of lista) {
      const segundos = randInt(sMin, sMax);
      await ui.openUrl(enlace, pkg);
      await sleep(2500);

      const sonando = await asegurarReproduccion(ui, sleep);
      if (!sonando) {
        stats.fallidas++;
        detalle.push({ enlace, ok: false });
        continue;
      }
      const pista = await pistaActual(ui);
      await sleep(segundos * 1000);

      stats.reproducciones++;
      stats.segundos += segundos;
      detalle.push({ enlace, ok: true, segundos, pista: pista?.titulo || null });

      if (p.save_track) { await ui.tapAny(L.meGusta); await sleep(800); }
      await sleep(randInt(gMin, gMax) * 1000);
    }
  }

  return {
    success: stats.reproducciones > 0,
    message: `Campaña: ${stats.reproducciones} reproducciones (${Math.round(stats.segundos / 60)} min), ${stats.fallidas} fallidas`,
    data: { ...stats, detalle },
  };
}

// Escucha "orgánica": recorre la portada, entra en elementos y reproduce, con
// probabilidad de guardar o saltar. El equivalente al warmup de TikMatrix.
async function warmup(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const totalMin = Number(p.duration_min ?? 10);
  const [sMin, sMax] = [Number(p.play_min_sec ?? 30), Number(p.play_max_sec ?? 90)];
  const prob = {
    guardar: Number(p.p_save ?? 0.10),
    saltar: Number(p.p_skip ?? 0.20),
    seguir: Number(p.p_follow ?? 0.05),
  };

  await ui.openApp(pkg);
  await ui.tapAny(L.inicio);
  await sleep(2000);

  const limite = Date.now() + totalMin * 60 * 1000;
  const stats = { reproducidas: 0, guardadas: 0, saltadas: 0, seguidos: 0, segundos: 0 };

  while (Date.now() < limite) {
    // Elige un elemento pulsable de la portada, esquivando la barra inferior.
    const ns = await ui.dump();
    const { h } = ui.size();
    const items = ns.filter(n => n.bounds && n.clickable &&
      n.bounds.y1 > h * 0.18 && n.bounds.y2 < h * 0.88 && (n.text || n.desc));
    if (!items.length) { await ui.scrollList(); continue; }

    const elegido = items[randInt(0, items.length - 1)];
    await ui.tapXY(elegido.cx, elegido.cy);
    await sleep(3000);

    if (await asegurarReproduccion(ui, sleep)) {
      const segundos = randInt(sMin, sMax);
      stats.reproducidas++;
      await sleep(Math.min(segundos, Math.max(0, (limite - Date.now()) / 1000)) * 1000);
      stats.segundos += segundos;

      if (Math.random() < prob.guardar) { if (await ui.tapAny(L.meGusta)) { stats.guardadas++; await sleep(700); } }
      if (Math.random() < prob.seguir)  { if (await ui.tapAny(L.seguir))  { stats.seguidos++;  await sleep(700); } }
      if (Math.random() < prob.saltar)  { if (await ui.tapAny(L.siguiente)) { stats.saltadas++; await sleep(1200); } }
    }

    await ui.back();
    await sleep(randInt(1200, 3000));
  }

  return {
    success: stats.reproducidas > 0,
    message: `Warmup: ${stats.reproducidas} reproducciones (${Math.round(stats.segundos / 60)} min), ${stats.guardadas} guardadas, ${stats.seguidos} artistas seguidos, ${stats.saltadas} saltos`,
    data: stats,
  };
}

async function followArtist(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const objetivos = toList(p.artists ?? p.artist);
  if (!objetivos.length) return { success: false, message: 'Falta la lista de artistas' };

  let seguidos = 0, fallidos = 0;
  for (const objetivo of objetivos) {
    const enlace = normalizarEnlace(objetivo, 'artist');
    if (/^spotify:|^https?:/i.test(enlace)) {
      await ui.openUrl(enlace, pkg);
    } else {
      await ui.openApp(pkg);
      if (!await ui.tapAny(L.buscar)) { fallidos++; continue; }
      await sleep(1500);
      const ns = await ui.dump();
      const campo = ns.find(n => n.bounds && /EditText/i.test(n.clase));
      if (campo) { await ui.tapXY(campo.cx, campo.cy); await sleep(800); }
      await ui.type(objetivo);
      await ui.enter();
      await sleep(3000);
      await ui.tapAny(L.artistas);
      await sleep(2000);
      const res = await ui.dump();
      const { h } = ui.size();
      const primero = res.filter(n => n.bounds && n.clickable && n.bounds.y1 > h * 0.20)
                         .sort((a, b) => a.bounds.y1 - b.bounds.y1)[0];
      if (!primero) { fallidos++; continue; }
      await ui.tapXY(primero.cx, primero.cy);
    }
    await sleep(3000);

    const ns = await ui.dump();
    if (ui.find(ns, L.siguiendo)) { continue; }   // ya seguido: no tocar
    if (await ui.tapAny(L.seguir, { ns })) { seguidos++; await sleep(1200); }
    else fallidos++;
    await sleep(randInt(1500, 3500));
  }

  return {
    success: seguidos > 0,
    message: `Artistas seguidos: ${seguidos} (${fallidos} fallidos de ${objetivos.length})`,
    data: { seguidos, fallidos },
  };
}

async function saveTrack(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const enlace = normalizarEnlace(p.url ?? p.track, 'track');

  if (enlace) { await ui.openUrl(enlace, pkg); await sleep(3000); }
  else { await ui.openApp(pkg); await sleep(1500); }

  const ns = await ui.dump();
  if (ui.find(ns, L.yaGuardado)) {
    return { success: true, message: 'La pista ya estaba en Tus me gusta', data: { ya_estaba: true } };
  }
  const ok = await ui.tapAny(L.meGusta, { ns });
  await sleep(1200);
  const pista = await pistaActual(ui);
  return {
    success: ok,
    message: ok ? `Guardada en Tus me gusta${pista ? `: ${pista.titulo}` : ''}` : 'No se encontró el control de Me gusta',
    data: { pista },
  };
}

async function createPlaylist(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const nombre = spin(String(p.name || '').trim());
  if (!nombre) return { success: false, message: 'Falta el nombre de la playlist' };

  await ui.openApp(pkg);
  if (!await ui.tapAny(L.crear)) {
    // En versiones sin pestaña Crear, se hace desde Tu biblioteca con el +.
    if (!await ui.tapAny(L.biblioteca)) return { success: false, message: 'No se encontró dónde crear la playlist' };
    await sleep(1800);
    await ui.tapAny(['Crear', 'Create', 'Agregar', 'Add']);
  }
  await sleep(2000);
  await ui.tapAny(['Playlist', 'Lista de reproducción']);
  await sleep(2500);

  const ns = await ui.dump();
  const campo = ns.find(n => n.bounds && /EditText/i.test(n.clase));
  if (campo) { await ui.tapXY(campo.cx, campo.cy); await sleep(700); }
  await ui.type(nombre);
  await sleep(600);
  const ok = await ui.tapAny(L.guardar);
  await sleep(2500);

  return {
    success: ok,
    message: ok ? `Playlist creada: ${nombre}` : 'No se pudo confirmar la creación',
    data: { nombre },
  };
}

async function addToPlaylist(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const playlist = String(p.playlist || '').trim();
  if (!playlist) return { success: false, message: 'Falta el nombre de la playlist destino' };
  const enlace = normalizarEnlace(p.url ?? p.track, 'track');

  if (enlace) { await ui.openUrl(enlace, pkg); await sleep(3000); }
  else { await ui.openApp(pkg); await sleep(1500); }

  if (!await ui.tapAny(L.masOpciones)) return { success: false, message: 'No se encontró el menú de la pista' };
  await sleep(1800);
  if (!await ui.tapAny(L.agregarA)) { await ui.back(); return { success: false, message: 'No se encontró "Agregar a"' }; }
  await sleep(2000);

  const ns = await ui.dump();
  const destino = ns.find(n => n.bounds && new RegExp(playlist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    .test(`${n.text} ${n.desc}`));
  if (!destino) { await ui.back(); return { success: false, message: `No se encontró la playlist "${playlist}"` }; }

  await ui.tapXY(destino.cx, destino.cy);
  await sleep(2000);
  return { success: true, message: `Pista agregada a "${playlist}"`, data: { playlist } };
}

async function playback(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const accion = String(p.action || 'play').toLowerCase();
  await ui.openApp(pkgFor(p));
  await sleep(1200);

  const mapa = {
    play: L.reproducir, pause: L.pausar, next: L.siguiente,
    previous: L.anterior, shuffle: L.aleatorio, repeat: L.repetir, save: L.meGusta,
  };
  const etiquetas = mapa[accion];
  if (!etiquetas) return { success: false, message: `Acción no soportada: ${accion}` };

  const veces = Number(p.times ?? 1);
  let hechas = 0;
  for (let i = 0; i < veces; i++) {
    if (await ui.tapAny(etiquetas)) { hechas++; await sleep(randInt(600, 1400)); }
  }
  return {
    success: hechas > 0,
    message: `${accion}: ${hechas}/${veces} aplicadas`,
    data: { accion, hechas },
  };
}

async function testScript(ctx, serial, p, ui) {
  const pkg = pkgFor(p);
  const informe = {};

  const paquetes = String(await ctx.shell(serial, ['pm', 'list', 'packages']).catch(() => ''));
  informe.app_instalada = paquetes.includes(pkg);

  await ui.openApp(pkg);
  const ns = await ui.dump();

  // Después del volcado: antes, ui.size() aún devuelve el tamaño registrado del
  // dispositivo, que en este parque no coincide con el espacio de coordenadas.
  const { w, h } = ui.size();
  informe.resolucion = `${w}x${h}`;
  informe.nodos_ui = ns.length;
  informe.lectura_ui = ns.length > 0;
  informe.sesion_iniciada = !!ui.find(ns, L.inicio) || !!ui.find(ns, L.biblioteca);
  informe.reproduciendo = !!ui.find(ns, L.pausar);
  informe.pista = await pistaActual(ui);
  informe.textos_visibles = ns.filter(n => n.text).slice(0, 5).map(n => n.text);

  const problemas = [];
  if (!informe.app_instalada) problemas.push(`${pkg} no está instalada`);
  if (!informe.lectura_ui) problemas.push('no se puede leer la pantalla (¿agente activo?)');
  if (!informe.sesion_iniciada) problemas.push('no se detecta sesión iniciada en Spotify');

  return {
    success: problemas.length === 0,
    message: problemas.length
      ? `Comprobación con avisos: ${problemas.join(' · ')}`
      : `Spotify listo · ${informe.resolucion} · ${informe.nodos_ui} nodos${informe.reproduciendo ? ' · reproduciendo' : ''}`,
    data: informe,
  };
}

// --------------------------------------------------------------- despachador

function ejecutarScript(ctx, serial, command, p, ui) {
  switch (command) {
    case 'SPOTIFY_LOGIN':            return login(ctx, serial, p, ui);
    case 'SPOTIFY_MATCH_ACCOUNT':    return matchAccount(ctx, serial, p, ui);
    case 'SPOTIFY_PLAY_URL':         return playUrl(ctx, serial, p, ui);
    case 'SPOTIFY_SEARCH_PLAY':      return searchPlay(ctx, serial, p, ui);
    case 'SPOTIFY_STREAM_CAMPAIGN':  return streamCampaign(ctx, serial, p, ui);
    case 'SPOTIFY_WARMUP':           return warmup(ctx, serial, p, ui);
    case 'SPOTIFY_FOLLOW_ARTIST':    return followArtist(ctx, serial, p, ui);
    case 'SPOTIFY_SAVE_TRACK':       return saveTrack(ctx, serial, p, ui);
    case 'SPOTIFY_CREATE_PLAYLIST':  return createPlaylist(ctx, serial, p, ui);
    case 'SPOTIFY_ADD_TO_PLAYLIST':  return addToPlaylist(ctx, serial, p, ui);
    case 'SPOTIFY_PLAYBACK':         return playback(ctx, serial, p, ui);
    case 'SPOTIFY_TEST_SCRIPT':      return testScript(ctx, serial, p, ui);
    default:
      return { success: false, message: `Script de Spotify no soportado: ${command}` };
  }
}

// Mismo bloque de opciones comunes que la suite de TikMatrix: intervalo de
// tarea, rotación de proxy previa y cierre de la app al terminar.
async function run(ctx, serial, command, p) {
  const ui = K.makeUi(ctx, serial);

  const iMin = Number(p.task_interval_min ?? 0);
  const iMax = Number(p.task_interval_max ?? 0);
  if (iMax > 0) {
    const espera = randInt(Math.min(iMin, iMax), iMax);
    if (espera > 0) await ctx.sleep(espera * 60 * 1000);
  }

  let rotacion = null;
  if (p.rotate_proxy && ctx.execute) {
    rotacion = await ctx.execute(serial, 'TIKMATRIX_ROTATE_PROXY', {})
      .catch(e => ({ success: false, message: e.message }));
    if (!rotacion.success) {
      return { success: false, message: `Rotación de proxy fallida, no se ejecuta el script: ${rotacion.message}`, data: { rotacion } };
    }
  }

  let r;
  try {
    r = await ejecutarScript(ctx, serial, command, p, ui);
  } catch (e) {
    r = { success: false, message: e.message };
  }

  if (p.close_app_after !== false) {
    await ctx.shell(serial, ['am', 'force-stop', pkgFor(p)]).catch(() => {});
  }

  return { ...r, data: { ...(r.data || {}), rotacion } };
}

module.exports = { handles, run, COMMANDS, PAQUETE, L, normalizarEnlace };
