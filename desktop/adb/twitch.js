// Suite de scripts para Twitch, con la misma forma que las de TikTok y Spotify.
//
// Las etiquetas salen del volcado real de la app en un SM-G998U en español:
// de ahí "Reproductor de streams Toca dos veces para entrar al stream" o los
// resource-id follow_button_container y viewer_count_text, que son más estables
// que el texto visible.

const K = require('./ui-kit');
const { randInt, toList, pickTemplate, decorate, parseCount } = K;

const L = {
  inicio:      ['Inicio', 'Home'],
  explorar:    ['Explorar', 'Browse', 'Discover'],
  actividad:   ['Actividad', 'Activity'],
  perfil:      ['Perfil', 'Profile'],
  siguiendo:   ['Siguiendo', 'Following'],
  enVivo:      ['En vivo', 'EN VIVO', 'Live', 'LIVE'],
  clips:       ['Clips'],
  buscar:      ['Buscar', 'Search'],

  seguir:      ['Seguir', 'Follow'],
  dejarSeguir: ['Dejar de seguir', 'Unfollow', 'Siguiendo', 'Following'],
  compartir:   ['Compartir', 'Share'],
  menu:        ['Opciones del menú', 'Menu options', 'Más opciones', 'More options'],
  sonidoOn:    ['Activar sonido', 'Unmute'],
  sonidoOff:   ['Silenciar', 'Mute'],
  reproductor: ['Reproductor de streams', 'Stream player'],

  chat:        ['Chat', 'Enviar un mensaje', 'Send a message', 'Escribe un mensaje'],
  enviar:      ['Enviar', 'Send'],
  espectadores: ['espectadores', 'viewers'],
};

// resource-id: sobreviven mejor que el texto a cambios de idioma o de versión.
const IDS = {
  seguir:       'follow_button_container',
  espectadores: 'viewer_count_text',
  canal:        'channel_text',
  compartir:    'share_button',
  feed:         'feed_item_pager',
};

const PAQUETE = 'tv.twitch.android.app';

const COMMANDS = new Set([
  'TWITCH_LOGIN',
  'TWITCH_MATCH_ACCOUNT',
  'TWITCH_WATCH_STREAM',
  'TWITCH_WATCH_CAMPAIGN',
  'TWITCH_WARMUP',
  'TWITCH_FOLLOW_CHANNEL',
  'TWITCH_UNFOLLOW_CHANNEL',
  'TWITCH_CHAT_MESSAGE',
  'TWITCH_PLAYBACK',
  'TWITCH_TEST_SCRIPT',
]);

function handles(command) { return COMMANDS.has(command); }
function pkgFor(p) { return String(p.package_name || PAQUETE); }

function enlaceCanal(canal) {
  const c = String(canal || '').replace(/^@/, '').trim();
  if (!c) return '';
  if (/^https?:\/\//i.test(c)) return c.split('?')[0];
  return `https://www.twitch.tv/${c}`;
}

// Busca un nodo por resource-id (más estable que por texto).
function porId(ns, sufijo) {
  return ns.find(n => n.bounds && n.id && n.id.endsWith(sufijo)) || null;
}

// Lee cuántos espectadores marca el stream en pantalla.
function espectadores(ns) {
  const n = porId(ns, IDS.espectadores);
  if (n) return parseCount(n.text || n.desc);
  const alt = ns.find(x => /(\d[\d.,]*\s*[KMB]?)\s*(espectadores|viewers)/i.test(`${x.text} ${x.desc}`));
  return alt ? parseCount(`${alt.text} ${alt.desc}`) : null;
}

// ------------------------------------------------------------------ scripts

async function login(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const usuario = String(p.username || p.email || '').trim();
  const password = String(p.password || '');
  if (!usuario || !password) return { success: false, message: 'Faltan credenciales' };

  await ui.openApp(pkgFor(p));
  await sleep(2500);
  await ui.tapAny(['Iniciar sesión', 'Log In', 'Log in']);
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
  const pass = campos2[1] || campos2[0];
  if (pass) { await ui.tapXY(pass.cx, pass.cy); await sleep(700); await ui.type(password); }

  await sleep(500);
  if (!await ui.tapAny(['Iniciar sesión', 'Log In'])) await ui.enter();
  await sleep(8000);
  await ui.dismissPopups();

  const final = await ui.dump();
  const dentro = !!ui.find(final, L.inicio) || !!ui.find(final, L.explorar);
  return {
    success: dentro,
    message: dentro ? `Sesión iniciada con ${usuario}` : 'No se pudo confirmar el acceso (Twitch suele pedir verificación)',
    data: { usuario },
  };
}

async function matchAccount(ctx, serial, p, ui) {
  const { sleep } = ctx;
  await ui.openApp(pkgFor(p));
  if (!await ui.tapAny(L.perfil)) return { success: false, message: 'No se encontró la pestaña Perfil' };
  await sleep(3000);

  const ns = await ui.dump();
  const { h } = ui.size();
  const candidato = ns
    .filter(n => n.bounds && n.text && n.bounds.y1 > h * 0.08 && n.bounds.y1 < h * 0.45)
    .map(n => n.text.trim())
    .find(t => /^[A-Za-z0-9_]{3,25}$/.test(t));

  await ui.back();
  return {
    success: !!candidato,
    message: candidato ? `Cuenta de Twitch en el dispositivo: ${candidato}` : 'No se pudo leer la cuenta',
    data: { cuenta: candidato || null },
  };
}

async function watchStream(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const canal = String(p.channel || p.canal || '').trim();
  if (!canal) return { success: false, message: 'Falta el canal' };
  const segundos = Number(p.watch_seconds ?? 120);

  await ui.openUrl(enlaceCanal(canal), pkg);
  await sleep(6000);
  await ui.dismissPopups();

  const ns = await ui.dump();
  const vivo = !!ui.find(ns, L.enVivo);
  const espec = espectadores(ns);

  if (p.unmute) { await ui.tapAny(L.sonidoOn); await sleep(800); }
  if (p.follow) {
    const btn = porId(ns, IDS.seguir) || ui.find(ns, L.seguir);
    if (btn) { await ui.tapXY(btn.cx, btn.cy); await sleep(1500); }
  }

  // Toques ocasionales para que la sesión no se marque inactiva.
  const fin = Date.now() + segundos * 1000;
  while (Date.now() < fin) {
    const resta = fin - Date.now();
    await sleep(Math.min(resta, randInt(25000, 45000)));
    if (Date.now() < fin) {
      const { w, h } = ui.size();
      await ui.tapXY(w * 0.5, h * 0.30);   // muestra los controles, no cambia de stream
      await sleep(600);
    }
  }

  return {
    success: true,
    message: `Visto ${segundos}s de ${canal}${vivo ? ' (en vivo)' : ' (puede no estar emitiendo)'}${espec ? ` · ${espec} espectadores` : ''}`,
    data: { canal, segundos, en_vivo: vivo, espectadores: espec },
  };
}

async function watchCampaign(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const canales = toList(p.channels ?? p.canales);
  if (!canales.length) return { success: false, message: 'Falta la lista de canales' };

  const pasadas = Number(p.repeat ?? 1);
  const [wMin, wMax] = [Number(p.watch_min_sec ?? 90), Number(p.watch_max_sec ?? 240)];
  const [gMin, gMax] = [Number(p.gap_min_sec ?? 5), Number(p.gap_max_sec ?? 20)];
  const orden = p.order || 'sequential';

  const stats = { vistos: 0, fallidos: 0, segundos: 0, seguidos: 0 };
  const detalle = [];

  for (let r = 0; r < pasadas; r++) {
    const lista = orden === 'random' ? [...canales].sort(() => Math.random() - 0.5) : canales;
    for (const canal of lista) {
      const segundos = randInt(wMin, wMax);
      await ui.openUrl(enlaceCanal(canal), pkg);
      await sleep(6000);
      await ui.dismissPopups();

      const ns = await ui.dump();
      if (!ui.find(ns, L.enVivo)) {
        stats.fallidos++;
        detalle.push({ canal, ok: false, motivo: 'no está en vivo' });
        continue;
      }

      if (p.follow) {
        const btn = porId(ns, IDS.seguir) || ui.find(ns, L.seguir);
        if (btn) { await ui.tapXY(btn.cx, btn.cy); stats.seguidos++; await sleep(1200); }
      }

      const fin = Date.now() + segundos * 1000;
      while (Date.now() < fin) {
        await sleep(Math.min(fin - Date.now(), randInt(25000, 45000)));
        if (Date.now() < fin) {
          const { w, h } = ui.size();
          await ui.tapXY(w * 0.5, h * 0.30);
          await sleep(600);
        }
      }

      stats.vistos++;
      stats.segundos += segundos;
      detalle.push({ canal, ok: true, segundos, espectadores: espectadores(ns) });
      await sleep(randInt(gMin, gMax) * 1000);
    }
  }

  return {
    success: stats.vistos > 0,
    message: `Campaña: ${stats.vistos} streams vistos (${Math.round(stats.segundos / 60)} min), ${stats.seguidos} seguidos, ${stats.fallidos} sin emisión`,
    data: { ...stats, detalle },
  };
}

// Recorre el feed de descubrimiento viendo streams, con probabilidad de seguir.
async function warmup(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const totalMin = Number(p.duration_min ?? 10);
  const [wMin, wMax] = [Number(p.watch_min_sec ?? 30), Number(p.watch_max_sec ?? 120)];
  const pSeguir = Number(p.p_follow ?? 0.08);

  await ui.openApp(pkg);
  await ui.tapAny(L.inicio);
  await sleep(3000);

  const limite = Date.now() + totalMin * 60 * 1000;
  const stats = { vistos: 0, seguidos: 0, segundos: 0 };

  while (Date.now() < limite) {
    const ns = await ui.dump();
    const segundos = Math.min(randInt(wMin, wMax), Math.max(5, Math.round((limite - Date.now()) / 1000)));

    if (Math.random() < pSeguir) {
      const btn = porId(ns, IDS.seguir) || ui.find(ns, L.seguir);
      if (btn) { await ui.tapXY(btn.cx, btn.cy); stats.seguidos++; await sleep(1200); }
    }

    await sleep(segundos * 1000);
    stats.vistos++;
    stats.segundos += segundos;

    // Siguiente stream del feed: deslizar hacia arriba.
    const { w, h } = ui.size();
    await ui.swipe(w * 0.5, h * 0.75, w * 0.5, h * 0.25, randInt(220, 380));
    await sleep(randInt(2000, 4000));
  }

  return {
    success: stats.vistos > 0,
    message: `Warmup: ${stats.vistos} streams (${Math.round(stats.segundos / 60)} min), ${stats.seguidos} canales seguidos`,
    data: stats,
  };
}

async function followChannel(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const canales = toList(p.channels ?? p.channel);
  if (!canales.length) return { success: false, message: 'Falta la lista de canales' };

  let hechos = 0, fallidos = 0;
  for (const canal of canales) {
    await ui.openUrl(enlaceCanal(canal), pkg);
    await sleep(5000);
    await ui.dismissPopups();

    const ns = await ui.dump();
    if (ui.find(ns, ['Siguiendo', 'Following'])) { continue; }   // ya seguido
    const btn = porId(ns, IDS.seguir) || ui.find(ns, L.seguir);
    if (btn) { await ui.tapXY(btn.cx, btn.cy); hechos++; await sleep(1500); }
    else fallidos++;
    await sleep(randInt(2000, 5000));
  }

  return {
    success: hechos > 0,
    message: `Canales seguidos: ${hechos} (${fallidos} fallidos de ${canales.length})`,
    data: { seguidos: hechos, fallidos },
  };
}

async function unfollowChannel(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const canales = toList(p.channels ?? p.channel);
  if (!canales.length) return { success: false, message: 'Falta la lista de canales' };

  let hechos = 0;
  for (const canal of canales) {
    await ui.openUrl(enlaceCanal(canal), pkg);
    await sleep(5000);
    if (await ui.tapAny(['Siguiendo', 'Following'])) {
      await sleep(1200);
      await ui.tapAny(['Dejar de seguir', 'Unfollow', 'Sí', 'Yes']);
      hechos++;
      await sleep(1500);
    }
    await sleep(randInt(2000, 4000));
  }
  return { success: hechos > 0, message: `Dejados de seguir: ${hechos}/${canales.length}`, data: { hechos } };
}

async function chatMessage(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const canal = String(p.channel || '').trim();
  const mensajes = toList(p.messages ?? p.message);
  if (!canal) return { success: false, message: 'Falta el canal' };
  if (!mensajes.length) return { success: false, message: 'Falta el contenido del mensaje' };

  const cuantos = Number(p.count ?? 1);
  const orden = p.order || 'random';
  const [gMin, gMax] = [Number(p.gap_min_sec ?? 20), Number(p.gap_max_sec ?? 60)];

  await ui.openUrl(enlaceCanal(canal), pkg);
  await sleep(6000);
  await ui.dismissPopups();

  let enviados = 0;
  for (let i = 0; i < cuantos; i++) {
    const ns = await ui.dump();
    const campo = ns.find(n => n.bounds && /EditText/i.test(n.clase)) || ui.find(ns, L.chat);
    if (!campo) break;
    await ui.tapXY(campo.cx, campo.cy);
    await sleep(1000);
    await ui.type(decorate(pickTemplate(mensajes, orden, i), p));
    await sleep(600);
    if (!await ui.tapAny(L.enviar)) await ui.enter();
    enviados++;
    await sleep(randInt(gMin, gMax) * 1000);
  }

  return {
    success: enviados > 0,
    message: `Mensajes enviados al chat de ${canal}: ${enviados}/${cuantos}`,
    data: { canal, enviados },
  };
}

async function playback(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const accion = String(p.action || 'unmute').toLowerCase();
  await ui.openApp(pkgFor(p));
  await sleep(1500);

  const mapa = { unmute: L.sonidoOn, mute: L.sonidoOff, share: L.compartir, menu: L.menu };
  const etiquetas = mapa[accion];
  if (!etiquetas) return { success: false, message: `Acción no soportada: ${accion}` };

  const ok = await ui.tapAny(etiquetas);
  return { success: ok, message: ok ? `${accion} aplicada` : `No se encontró el control para ${accion}`, data: { accion } };
}

async function testScript(ctx, serial, p, ui) {
  const pkg = pkgFor(p);
  const informe = {};

  const paquetes = String(await ctx.shell(serial, ['pm', 'list', 'packages']).catch(() => ''));
  informe.app_instalada = paquetes.includes(pkg);

  await ui.openApp(pkg);
  await ctx.sleep(6000);
  const ns = await ui.dump();

  // La resolución se consulta DESPUÉS del volcado: es entonces cuando se conoce
  // el espacio de coordenadas real, y no el tamaño registrado del dispositivo.
  const { w, h } = ui.size();
  informe.resolucion = `${w}x${h}`;
  informe.nodos_ui = ns.length;
  informe.lectura_ui = ns.length > 0;
  informe.sesion_iniciada = !!ui.find(ns, L.perfil) || !!ui.find(ns, L.actividad);
  informe.hay_directo = !!ui.find(ns, L.enVivo);
  informe.espectadores = espectadores(ns);
  informe.textos_visibles = ns.filter(n => n.text).slice(0, 5).map(n => n.text);

  const problemas = [];
  if (!informe.app_instalada) problemas.push(`${pkg} no está instalada`);
  if (!informe.lectura_ui) problemas.push('no se puede leer la pantalla (¿agente activo?)');
  if (!informe.sesion_iniciada) problemas.push('no se detecta sesión iniciada en Twitch');

  return {
    success: problemas.length === 0,
    message: problemas.length
      ? `Comprobación con avisos: ${problemas.join(' · ')}`
      : `Twitch listo · ${informe.resolucion} · ${informe.nodos_ui} nodos${informe.hay_directo ? ' · hay directo en pantalla' : ''}`,
    data: informe,
  };
}

// --------------------------------------------------------------- despachador

function ejecutarScript(ctx, serial, command, p, ui) {
  switch (command) {
    case 'TWITCH_LOGIN':            return login(ctx, serial, p, ui);
    case 'TWITCH_MATCH_ACCOUNT':    return matchAccount(ctx, serial, p, ui);
    case 'TWITCH_WATCH_STREAM':     return watchStream(ctx, serial, p, ui);
    case 'TWITCH_WATCH_CAMPAIGN':   return watchCampaign(ctx, serial, p, ui);
    case 'TWITCH_WARMUP':           return warmup(ctx, serial, p, ui);
    case 'TWITCH_FOLLOW_CHANNEL':   return followChannel(ctx, serial, p, ui);
    case 'TWITCH_UNFOLLOW_CHANNEL': return unfollowChannel(ctx, serial, p, ui);
    case 'TWITCH_CHAT_MESSAGE':     return chatMessage(ctx, serial, p, ui);
    case 'TWITCH_PLAYBACK':         return playback(ctx, serial, p, ui);
    case 'TWITCH_TEST_SCRIPT':      return testScript(ctx, serial, p, ui);
    default:
      return { success: false, message: `Script de Twitch no soportado: ${command}` };
  }
}

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
    rotacion = await ctx.execute(serial, 'TIKTOK_ROTATE_PROXY', {})
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

module.exports = { handles, run, COMMANDS, PAQUETE, L, IDS, enlaceCanal };
