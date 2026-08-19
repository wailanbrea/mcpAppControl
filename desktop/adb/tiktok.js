// Suite de scripts de TikTok — Bsolutions Control App.
//
// Cada script sigue la documentación oficial de tikmatrix.com/docs/tutorial-scripts.
// A diferencia del primer lote de comandos TIKTOK_*, que tocaba coordenadas fijas
// (w*0.92, h*0.54…), aquí se localizan los controles por texto/content-desc leyendo el
// árbol de uiautomator: los porcentajes se rompen en cuanto cambia el modelo, la
// densidad o el idioma del teléfono, y la granja tiene teléfonos distintos.
//
// El contexto (ctx) lo inyecta adb/index.js para reutilizar su cola de concurrencia
// ADB, el jitter humano y el dump de UI en vez de duplicarlos.

// Etiquetas bilingües: los teléfonos de la granja no están todos en el mismo idioma.
const L = {
  follow:      ['Seguir', 'Follow'],
  following:   ['Siguiendo', 'Following'],
  unfollow:    ['Dejar de seguir', 'Unfollow'],
  like:        ['Me gusta', 'Like'],
  comment:     ['Comentar', 'Comment', 'Comentarios', 'Comments'],
  favorite:    ['Favoritos', 'Favorite', 'Añadir a Favoritos', 'Add to Favorites', 'Guardar', 'Collect'],
  share:       ['Compartir', 'Share'],
  repost:      ['Volver a publicar', 'Repost'],
  message:     ['Mensaje', 'Message'],
  send:        ['Enviar', 'Send'],
  post:        ['Publicar', 'Post'],
  next:        ['Siguiente', 'Next'],
  search:      ['Buscar', 'Search'],
  profile:     ['Perfil', 'Profile', 'Yo', 'Me'],
  editProfile: ['Editar perfil', 'Edit profile'],
  save:        ['Guardar', 'Save', 'Listo', 'Done', 'Confirmar', 'Confirm'],
  suggested:   ['Sugeridas', 'Sugeridos', 'Suggested', 'Sugerencias'],
  followers:   ['Seguidores', 'Followers'],
  delete:      ['Eliminar', 'Borrar', 'Delete'],
  privacy:     ['Configuración de privacidad', 'Privacy settings', 'Privacidad', 'Privacy'],
  more:        ['Más', 'More', 'Opciones', 'Options'],
  live:        ['EN VIVO', 'LIVE', 'En directo'],
  ad:          ['Patrocinado', 'Sponsored', 'Publicidad', 'Ad'],
  dismiss:     ['Ahora no', 'Not now', 'Cancelar', 'Cancel', 'Entendido', 'Got it', 'OK', 'Aceptar', 'Cerrar', 'Close'],
};

// Paquetes soportados (App Package Selection de la doc). Cualquier otro valor
// explícito en package_name se respeta tal cual, para clones con prefijo propio.
const PACKAGES = {
  tiktok:        'com.zhiliaoapp.musically',   // TikTok Global
  tiktok_asia:   'com.ss.android.ugc.trill',   // TikTok Asia/International
  instagram:     'com.instagram.android',
};

const EMOJIS = ['🔥', '😍', '👏', '💯', '❤️', '😂', '🙌', '✨', '👀', '🤩'];

const COMMANDS = new Set([
  'TIKTOK_LOGIN',
  'TIKTOK_FILL_PROFILE',
  'TIKTOK_MATCH_ACCOUNTS',
  'TIKTOK_SWITCH_ACCOUNT',
  'TIKTOK_ACCOUNT_WARMUP',
  'TIKTOK_PUBLISH_POST',
  'TIKTOK_DELETE_POSTS',
  'TIKTOK_PRIVACY_SETTINGS',
  'TIKTOK_BOOST_COMMENTS',
  'TIKTOK_BOOST_LIVES',
  'TIKTOK_BOOST_POSTS',
  'TIKTOK_SCRAPE_USERS',
  'TIKTOK_FOLLOW_BACK',
  'TIKTOK_FOLLOW_SUGGESTED',
  // Reemplaza al TIKTOK_UNFOLLOW_ALL por coordenadas fijas del switch de
  // adb/index.js: este localiza los botones por texto y sobrevive a otro modelo.
  'TIKTOK_UNFOLLOW_ALL',
  'TIKTOK_SUPER_MARKETING',
  'TIKTOK_TEST_SCRIPT',
  'TIKTOK_MASS_DM',
  'TIKTOK_MASS_COMMENT',
  'TIKTOK_LIST_PACKAGES',
]);

function handles(command) { return COMMANDS.has(command); }

// ---------------------------------------------------------------- utilidades
// Las primitivas de UI y las utilidades de plantillas viven en ui-kit.js, que
// comparten esta suite y la de Spotify.

const K = require('./ui-kit');
const { randInt, spin, toList, pickTemplate, fillVars, decorate, parseCount } = K;

function pkgFor(p) {
  if (p.package_name) return String(p.package_name);
  const key = String(p.platform || 'tiktok').toLowerCase();
  return PACKAGES[key] || PACKAGES.tiktok;
}

// ------------------------------------------------- primitivas de UI sobre ctx
// Extiende el kit común con los gestos propios de un feed vertical de vídeo.

function makeUi(ctx, serial) {
  const { shell, sleep } = ctx;
  const base = K.makeUi(ctx, serial);
  const { size, tapXY, swipe, dump, find, tapAny, type, openApp } = base;

  // Abre un perfil por deep link o buscándolo, según el "Profile opening method".
  const openProfile = async (username, method, pkg) => {
    const u = String(username || '').replace(/^@/, '').trim();
    if (!u) return false;
    if (method === 'search') {
      await openApp(pkg);
      if (!await tapAny(L.search)) return false;
      await sleep(1200);
      await type(u);
      await base.enter();
      await sleep(2500);
      const ns = await dump();
      const hit = ns.find(n => n.bounds && (n.text === u || n.text === `@${u}`));
      if (hit) { await tapXY(hit.cx, hit.cy); await sleep(2500); return true; }
      return false;
    }
    await shell(serial, ['am', 'start', '-a', 'android.intent.action.VIEW',
      '-d', `https://www.tiktok.com/@${u}`, pkg]).catch(() => {});
    await sleep(3500);
    await base.dismissPopups();
    return true;
  };

  // Deslizar al siguiente vídeo del feed.
  const nextVideo = async () => {
    const { w, h } = size();
    await swipe(w * 0.5, h * 0.78, w * 0.5, h * 0.22, randInt(180, 320));
    await sleep(randInt(700, 1400));
  };

  const doubleTapLike = async () => {
    const { w, h } = size();
    await tapXY(w * 0.5, h * 0.5);
    await sleep(90);
    await tapXY(w * 0.5, h * 0.5);
  };

  return { ...base, openProfile, nextVideo, doubleTapLike };
}
// ------------------------------------------------------------------- scripts

// Account Warmup: navega el feed y engancha con probabilidades configurables.
async function accountWarmup(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const viewMin = Number(p.view_min_sec ?? 5);
  const viewMax = Number(p.view_max_sec ?? 15);
  const totalMin = Number(p.duration_min ?? 10);
  const mode = String(p.browse_mode || 'foryou').toLowerCase();
  const keywords = toList(p.keywords);
  const comments = toList(p.comments);
  const order = p.comment_order || 'random';
  const prob = {
    like: Number(p.p_like ?? 0.30),
    follow: Number(p.p_follow ?? 0.05),
    comment: Number(p.p_comment ?? 0.05),
    favorite: Number(p.p_favorite ?? 0.05),
  };

  await ui.openApp(pkg);

  if (mode === 'search' && keywords.length) {
    if (await ui.tapAny(L.search)) {
      await sleep(1200);
      await ui.type(keywords[Math.floor(Math.random() * keywords.length)]);
      await ui.enter();
      await sleep(3000);
    }
  } else if (mode === 'following') {
    await ui.tapAny(L.following);
    await sleep(2000);
  }

  const deadline = Date.now() + totalMin * 60 * 1000;
  const stats = { viewed: 0, liked: 0, followed: 0, commented: 0, favorited: 0, skipped: 0 };
  let ci = 0;

  while (Date.now() < deadline) {
    const ns = await ui.dump();

    // Salta anuncios y directos, como hace el script original.
    if (ui.find(ns, L.ad) || ui.find(ns, L.live)) {
      stats.skipped++;
      await ui.nextVideo();
      continue;
    }

    await sleep(randInt(viewMin, viewMax) * 1000);
    stats.viewed++;

    if (Math.random() < prob.like) {
      // Evita volver a dar like: si ya está marcado, el content-desc lo refleja.
      const liked = ns.some(n => /liked|me gusta activado|unlike/i.test(n.desc));
      if (!liked) { await ui.doubleTapLike(); stats.liked++; await sleep(600); }
    }
    if (Math.random() < prob.favorite) {
      if (await ui.tapAny(L.favorite, { ns })) { stats.favorited++; await sleep(600); }
    }
    if (Math.random() < prob.follow) {
      if (await ui.tapAny(L.follow, { ns })) { stats.followed++; await sleep(800); }
    }
    if (comments.length && Math.random() < prob.comment) {
      if (await ui.tapAny(L.comment, { ns })) {
        await sleep(1800);
        const txt = decorate(pickTemplate(comments, order, ci++), p);
        await ui.type(txt);
        await sleep(700);
        if (!await ui.tapAny(L.post)) await ui.enter();
        stats.commented++;
        await sleep(1200);
        await ui.back();
        await sleep(800);
      }
    }

    await ui.nextVideo();
  }

  return {
    success: true,
    message: `Warmup completado: ${stats.viewed} vídeos, ${stats.liked} likes, ${stats.followed} follows, ${stats.commented} comentarios, ${stats.favorited} favoritos`,
    data: stats,
  };
}

// Fill Profile: nick, usuario, bio y avatar (primera foto de la galería).
async function fillProfile(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const order = p.selection_order || 'random';
  const idx = Number(p.index ?? 0);
  const nickname = pickTemplate(toList(p.nicknames ?? p.nickname), order, idx);
  const username = pickTemplate(toList(p.usernames ?? p.username), order, idx);
  const bio = pickTemplate(toList(p.bios ?? p.bio), order, idx);

  await ui.openApp(pkg);
  if (!await ui.tapAny(L.profile)) return { success: false, message: 'No se encontró la pestaña de perfil' };
  await sleep(2500);
  if (!await ui.tapAny(L.editProfile)) return { success: false, message: 'No se encontró "Editar perfil"' };
  await sleep(2000);

  const applied = [];
  const setField = async (labels, value) => {
    if (!value) return;
    const ns = await ui.dump();
    const n = ui.find(ns, labels);
    if (!n) return;
    await ui.tapXY(n.cx, n.cy);
    await sleep(1200);
    await ctx.shell(serial, ['am', 'broadcast', '-a', 'ADB_CLEAR_TEXT']).catch(() => {});
    await sleep(300);
    await ui.type(spin(value));
    await sleep(600);
    await ui.tapAny(L.save);
    await sleep(1200);
    applied.push(labels[0]);
  };

  await setField(['Nombre', 'Name', 'Nickname', 'Apodo'], nickname);
  await setField(['Nombre de usuario', 'Username'], username);
  await setField(['Biografía', 'Bio', 'Biografia'], bio);

  if (p.set_avatar) {
    // La doc recomienda limpiar la galería antes: se toma la primera foto.
    const ns = await ui.dump();
    const av = ui.find(ns, ['Cambiar foto', 'Change photo', 'Editar foto', 'Foto de perfil', 'Profile photo']);
    if (av) {
      await ui.tapXY(av.cx, av.cy);
      await sleep(1800);
      await ui.tapAny(['Seleccionar de la galería', 'Select from gallery', 'Galería', 'Gallery', 'Álbum', 'Album']);
      await sleep(2500);
      const { w, h } = ui.size();
      await ui.tapXY(w * 0.17, h * 0.28);   // primera miniatura de la cuadrícula
      await sleep(1500);
      await ui.tapAny(L.save);
      await sleep(1500);
      applied.push('avatar');
    }
  }

  await ui.tapAny(L.save);
  return {
    success: applied.length > 0,
    message: applied.length ? `Perfil actualizado (${applied.join(', ')})` : 'No se pudo editar ningún campo del perfil',
    data: { nickname, username, bio, applied },
  };
}

// Match Accounts: lee las cuentas presentes en el teléfono desde el selector.
async function matchAccounts(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  await ui.openApp(pkg);
  if (!await ui.tapAny(L.profile)) return { success: false, message: 'No se encontró la pestaña de perfil' };
  await sleep(2500);

  // El selector se abre pulsando el nombre de usuario de la cabecera.
  await ui.tapAny(['Cambiar cuenta', 'Switch account', 'Cuentas', 'Accounts']);
  await sleep(2000);

  const ns = await ui.dump();
  const found = new Set();
  for (const n of ns) {
    const cand = [n.text, n.desc].join(' ');
    const m = cand.match(/@([A-Za-z0-9._]{2,24})/);
    if (m) found.add(m[1]);
  }
  await ui.back();

  const usernames = [...found];
  return {
    success: usernames.length > 0,
    message: usernames.length
      ? `Cuentas detectadas en el dispositivo: ${usernames.join(', ')}`
      : 'No se detectaron cuentas (la doc advierte que puede requerir varias pasadas)',
    data: { usernames },
  };
}

// Scrape Users: seguidores, seguidos o búsqueda por palabra clave.
async function scrapeUsers(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const mode = String(p.mode || 'followers').toLowerCase();
  const max = Number(p.max_count ?? 50);
  const targets = toList(p.targets ?? p.username);
  const keywords = toList(p.keywords);

  if (mode === 'keyword') {
    if (!keywords.length) return { success: false, message: 'Falta la palabra clave de búsqueda' };
    await ui.openApp(pkg);
    if (!await ui.tapAny(L.search)) return { success: false, message: 'No se encontró el buscador' };
    await sleep(1200);
    await ui.type(keywords[0]);
    await ui.enter();
    await sleep(3000);
    await ui.tapAny(['Usuarios', 'Users', 'Cuentas', 'Accounts']);
    await sleep(2000);
  } else {
    if (!targets.length) return { success: false, message: 'Falta la cuenta objetivo' };
    if (!await ui.openProfile(targets[0], p.open_method, pkg)) {
      return { success: false, message: `No se pudo abrir el perfil de @${targets[0]}` };
    }
    const ok = await ui.tapAny(mode === 'following' ? L.following : L.followers);
    if (!ok) return { success: false, message: `No se encontró la lista de ${mode}` };
    await sleep(2500);
  }

  const users = new Set();
  let dry = 0;
  while (users.size < max && dry < 3) {
    const before = users.size;
    for (const n of await ui.dump()) {
      const m = [n.text, n.desc].join(' ').match(/@?([A-Za-z0-9._]{3,24})/);
      if (m && /^[A-Za-z0-9._]+$/.test(m[1]) && !/^(seguir|follow|siguiendo|following)$/i.test(m[1])) {
        users.add(m[1]);
        if (users.size >= max) break;
      }
    }
    if (users.size === before) dry++; else dry = 0;
    if (users.size < max) await ui.scrollList();
  }

  const list = [...users].slice(0, max);
  return {
    success: list.length > 0,
    message: `${list.length} usuarios extraídos (modo ${mode}). TikTok limita ~50 por pasada`,
    data: { mode, users: list, count: list.length },
  };
}

// Follow Suggested: sigue cuentas de la pestaña "Sugeridas".
async function followSuggested(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const max = Number(p.max_follow ?? 20);

  await ui.openApp(pkg);
  if (!await ui.tapAny(L.profile)) return { success: false, message: 'No se encontró la pestaña de perfil' };
  await sleep(2500);
  await ui.tapAny(L.following);
  await sleep(2000);
  await ui.tapAny(L.suggested);
  await sleep(2000);

  let followed = 0, dry = 0;
  while (followed < max && dry < 3) {
    const botones = ui.findAll(await ui.dump(), L.follow).filter(n => n.clickable || n.bounds);
    if (!botones.length) {
      dry++;
      await ui.scrollList();
      continue;
    }
    dry = 0;
    for (const b of botones) {
      if (followed >= max) break;
      await ui.tapXY(b.cx, b.cy);
      followed++;
      await sleep(randInt(900, 2200));   // pausa entre follows, como el script original
    }
    if (followed < max) await ui.scrollList();
  }

  return {
    success: followed > 0,
    message: `Seguidas ${followed} cuentas sugeridas (límite ${max})`,
    data: { followed, limit: max },
  };
}

// Mass DM: mensaje privado a una lista de usuarios, con plantillas y placeholders.
async function massDm(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const targets = toList(p.targets ?? p.usernames ?? p.username);
  const templates = toList(p.messages ?? p.message);
  if (!targets.length) return { success: false, message: 'Falta la lista de usuarios destino' };
  if (!templates.length) return { success: false, message: 'Falta el contenido del mensaje' };

  const order = p.message_order || 'random';
  const perTarget = Number(p.messages_per_target ?? 1);
  const sender = String(p.sender_username || '');
  const [gapMin, gapMax] = [Number(p.interval_min_sec ?? 20), Number(p.interval_max_sec ?? 60)];

  let sent = 0, failed = 0, ti = 0;
  const detail = [];

  for (const target of targets) {
    const ok = await ui.openProfile(target, p.open_method, pkg);
    if (!ok) { failed++; detail.push({ target, ok: false, reason: 'perfil no abierto' }); continue; }

    if (!await ui.tapAny(L.message)) {
      failed++; detail.push({ target, ok: false, reason: 'sin botón de mensaje' });
      continue;
    }
    await sleep(2500);

    for (let k = 0; k < perTarget; k++) {
      const txt = decorate(fillVars(pickTemplate(templates, order, ti++), { username: target, sender_username: sender }), p);
      await ui.type(txt);
      await sleep(700);
      if (!await ui.tapAny(L.send)) await ui.enter();
      sent++;
      await sleep(randInt(1200, 2500));
    }
    detail.push({ target, ok: true });
    await ui.back();
    await sleep(randInt(gapMin, gapMax) * 1000);
  }

  return {
    success: sent > 0,
    message: `DM enviados: ${sent} (${failed} objetivos fallidos de ${targets.length})`,
    data: { sent, failed, detail },
  };
}

// Mass Comment: comenta una lista de publicaciones por URL.
async function massComment(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const urls = toList(p.urls ?? p.post_urls);
  const templates = toList(p.comments ?? p.comment);
  if (!urls.length) return { success: false, message: 'Falta la lista de URLs de publicaciones' };
  if (!templates.length) return { success: false, message: 'Falta el contenido del comentario' };

  const order = p.comment_order || 'random';
  const perPost = Number(p.comments_per_target ?? 1);
  const [gapMin, gapMax] = [Number(p.interval_min_sec ?? 20), Number(p.interval_max_sec ?? 60)];
  const label = p.device_label ? ` ${p.device_label}` : '';

  let posted = 0, failed = 0, ci = 0;
  for (const url of urls) {
    await ui.openUrl(url, pkg);
    if (!await ui.tapAny(L.comment)) { failed++; continue; }
    await sleep(1800);
    for (let k = 0; k < perPost; k++) {
      const txt = decorate(pickTemplate(templates, order, ci++), p) + label;
      await ui.type(txt);
      await sleep(700);
      if (!await ui.tapAny(L.post)) await ui.enter();
      posted++;
      await sleep(randInt(1200, 2500));
    }
    await ui.back();
    await sleep(randInt(gapMin, gapMax) * 1000);
  }

  return {
    success: posted > 0,
    message: `Comentarios publicados: ${posted} (${failed} publicaciones fallidas de ${urls.length})`,
    data: { posted, failed },
  };
}

// Boost Posts: like / favorito / repost / compartir / ver, sobre URLs de posts.
async function boostPosts(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const urls = toList(p.urls ?? p.post_urls);
  if (!urls.length) return { success: false, message: 'Falta la lista de URLs de publicaciones' };

  const acts = {
    like: p.like !== false,
    favorite: !!p.favorite,
    repost: !!p.repost,
    share: !!p.share,
    comment: !!p.comment,
  };
  const templates = toList(p.comments);
  const order = p.comment_order || 'random';
  const repeats = Number(p.repeat ?? 1);
  const [vMin, vMax] = [Number(p.view_min_sec ?? 5), Number(p.view_max_sec ?? 20)];

  const stats = { visited: 0, liked: 0, favorited: 0, reposted: 0, shared: 0, commented: 0 };
  let ci = 0;

  for (let r = 0; r < repeats; r++) {
    for (const url of urls) {
      await ui.openUrl(url, pkg);
      stats.visited++;
      await sleep(randInt(vMin, vMax) * 1000);       // "Watch video"

      const ns = await ui.dump();
      if (acts.like)     { await ui.doubleTapLike(); stats.liked++; await sleep(700); }
      if (acts.favorite && await ui.tapAny(L.favorite, { ns })) { stats.favorited++; await sleep(700); }
      if (acts.repost   && await ui.tapAny(L.repost,  { ns })) { stats.reposted++; await sleep(900); await ui.back(); }
      if (acts.share    && await ui.tapAny(L.share,   { ns })) { stats.shared++;   await sleep(900); await ui.back(); }
      if (acts.comment && templates.length && await ui.tapAny(L.comment, { ns })) {
        await sleep(1800);
        await ui.type(decorate(pickTemplate(templates, order, ci++), p));
        await sleep(700);
        if (!await ui.tapAny(L.post)) await ui.enter();
        stats.commented++;
        await sleep(1200);
        await ui.back();
      }
      await sleep(randInt(1500, 4000));
    }
  }

  return { success: stats.visited > 0, message:
    `Boost de posts: ${stats.visited} visitas, ${stats.liked} likes, ${stats.favorited} favoritos, ${stats.commented} comentarios`,
    data: stats };
}

// Boost Lives: entra a directos, ve, da likes en intervalo y comenta.
async function boostLives(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const targets = toList(p.usernames ?? p.username);
  if (!targets.length) return { success: false, message: 'Falta la lista de streamers' };

  const viewSec = Number(p.view_duration_sec ?? 120);
  const likeEvery = Number(p.like_interval_sec ?? 15);
  const likeTaps = Number(p.like_tap_count ?? 5);
  const commentEvery = Number(p.comment_interval_sec ?? 45);
  const commentsPer = Number(p.comments_per_account ?? 3);
  const templates = toList(p.comments);
  const order = p.comment_order || 'random';

  const stats = { lives: 0, likes: 0, comments: 0 };
  let ci = 0;

  for (const target of targets) {
    const ok = await ui.openProfile(target, p.enter_method === 'search' ? 'search' : 'direct', pkg);
    if (!ok) continue;

    // El avatar con anillo de directo abre el LIVE al pulsarlo.
    const ns = await ui.dump();
    const liveNode = ui.find(ns, L.live);
    if (liveNode) { await ui.tapXY(liveNode.cx, liveNode.cy); await sleep(4000); }
    stats.lives++;

    if (p.join_fan_club) { await ui.tapAny(['Unirse', 'Join', 'Club de fans', 'Fan club']); await sleep(1500); }
    if (p.check_in_daily) { await ui.tapAny(['Registrarse', 'Check in', 'Check-in']); await sleep(1500); }

    const end = Date.now() + viewSec * 1000;
    let nextLike = Date.now() + likeEvery * 1000;
    let nextComment = Date.now() + commentEvery * 1000;
    let sentHere = 0;

    while (Date.now() < end) {
      const now = Date.now();
      if (p.like !== false && now >= nextLike) {
        const { w, h } = ui.size();
        for (let i = 0; i < likeTaps; i++) { await ui.tapXY(w * 0.92, h * 0.72); await sleep(120); }
        stats.likes += likeTaps;
        nextLike = now + likeEvery * 1000;
      }
      if (templates.length && sentHere < commentsPer && now >= nextComment) {
        if (await ui.tapAny(['Di algo', 'Say something', 'Comentar', 'Comment'])) {
          await sleep(1000);
          await ui.type(decorate(pickTemplate(templates, order, ci++), p));
          await sleep(500);
          await ui.enter();
          stats.comments++; sentHere++;
        }
        nextComment = now + commentEvery * 1000;
      }
      await sleep(1000);
    }
    await ui.back();
    await sleep(randInt(2000, 5000));
  }

  return { success: stats.lives > 0,
    message: `Boost de directos: ${stats.lives} lives, ${stats.likes} likes, ${stats.comments} comentarios`,
    data: stats };
}

// Boost Comments: like y respuesta sobre URLs de comentarios concretos.
async function boostComments(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const urls = toList(p.urls ?? p.comment_urls);
  if (!urls.length) return { success: false, message: 'Falta la lista de URLs de comentarios' };

  const doLike = p.like !== false;
  const doReply = !!p.reply;
  const templates = toList(p.replies ?? p.reply_contents);
  const order = p.reply_order || 'random';
  const gap = Number(p.interval_sec ?? 20);

  const stats = { visited: 0, liked: 0, replied: 0 };
  let ri = 0;

  for (const url of urls) {
    await ui.openUrl(url, pkg);
    stats.visited++;
    const ns = await ui.dump();

    if (doLike && await ui.tapAny(L.like, { ns })) { stats.liked++; await sleep(800); }
    if (doReply && templates.length) {
      if (await ui.tapAny(['Responder', 'Reply'], { ns })) {
        await sleep(1500);
        await ui.type(decorate(pickTemplate(templates, order, ri++), p));
        await sleep(700);
        if (!await ui.tapAny(L.post)) await ui.enter();
        stats.replied++;
        await sleep(1200);
      }
    }
    await ui.back();
    await sleep(gap * 1000);
  }

  return { success: stats.visited > 0,
    message: `Boost de comentarios: ${stats.liked} likes, ${stats.replied} respuestas`,
    data: stats };
}

// Recorre la pestaña de vídeos del perfil y devuelve los que no llegan al umbral.
async function lowViewPosts(ui, maxViews, maxPosts) {
  const out = [];
  const seen = new Set();
  let dry = 0;
  while (dry < 3 && (maxPosts === 0 || out.length < maxPosts)) {
    const before = out.length;
    for (const n of await ui.dump()) {
      if (!n.bounds) continue;
      const label = `${n.text} ${n.desc}`.trim();
      const views = parseCount(label);
      const key = `${n.cx},${n.cy},${label}`;
      if (views === null || seen.has(key)) continue;
      seen.add(key);
      if (views < maxViews) {
        out.push({ views, x: n.cx, y: n.cy });
        if (maxPosts !== 0 && out.length >= maxPosts) break;
      }
    }
    if (out.length === before) dry++; else dry = 0;
    await ui.scrollList();
  }
  return out;
}

// Delete Posts: borra publicaciones por debajo de un umbral de vistas.
async function deletePosts(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const maxViews = Number(p.max_views);
  if (!Number.isFinite(maxViews)) return { success: false, message: 'Falta max_views (umbral de vistas)' };
  const maxPosts = Number(p.max_posts ?? 0);

  await ui.openApp(pkg);
  if (!await ui.tapAny(L.profile)) return { success: false, message: 'No se encontró la pestaña de perfil' };
  await sleep(2500);

  const candidatos = await lowViewPosts(ui, maxViews, maxPosts);
  let borrados = 0;

  for (const c of candidatos) {
    await ui.tapXY(c.x, c.y);
    await sleep(2500);
    if (await ui.tapAny(L.more)) {
      await sleep(1500);
      if (await ui.tapAny(L.delete)) {
        await sleep(1200);
        await ui.tapAny(['Eliminar', 'Delete', 'Confirmar', 'Confirm', 'Sí', 'Yes']);
        borrados++;
        await sleep(2000);
      }
    }
    await ui.back();
    await sleep(1500);
  }

  return {
    success: borrados > 0,
    message: `Eliminadas ${borrados} de ${candidatos.length} publicaciones bajo ${maxViews} vistas. La doc avisa de que puede fallar; reintenta las que queden`,
    data: { deleted: borrados, candidates: candidatos.length, max_views: maxViews },
  };
}

// Privacy Settings: cambia privacidad en lote según vistas.
async function privacySettings(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const maxViews = Number(p.max_views);
  if (!Number.isFinite(maxViews)) return { success: false, message: 'Falta max_views (umbral de vistas)' };
  const maxPosts = Number(p.max_posts ?? 0);
  const audiencia = String(p.who_can_watch || 'friends').toLowerCase();
  const audienciaLabels = {
    everyone: ['Todos', 'Everyone', 'Público', 'Public'],
    friends:  ['Amigos', 'Friends'],
    only_me:  ['Solo tú', 'Only you', 'Privado', 'Private'],
  }[audiencia] || ['Amigos', 'Friends'];

  await ui.openApp(pkg);
  if (!await ui.tapAny(L.profile)) return { success: false, message: 'No se encontró la pestaña de perfil' };
  await sleep(2500);

  const candidatos = await lowViewPosts(ui, maxViews, maxPosts);
  let cambiados = 0;

  for (const c of candidatos) {
    await ui.tapXY(c.x, c.y);
    await sleep(2500);
    if (!await ui.tapAny(L.more)) { await ui.back(); continue; }
    await sleep(1500);
    if (!await ui.tapAny(L.privacy)) { await ui.back(); await ui.back(); continue; }
    await sleep(1500);

    if (await ui.tapAny(audienciaLabels)) cambiados++;
    await sleep(900);
    if (p.allow_comments === false) await ui.tapAny(['Permitir comentarios', 'Allow comments']);
    if (p.allow_reuse === false) await ui.tapAny(['Permitir reutilizar', 'Allow reuse', 'Permitir dúo', 'Allow Duet']);
    await sleep(600);
    await ui.back();
    await sleep(1000);
    await ui.back();
    await sleep(1500);
  }

  return {
    success: cambiados > 0,
    message: `Privacidad cambiada a "${audiencia}" en ${cambiados} de ${candidatos.length} publicaciones bajo ${maxViews} vistas`,
    data: { changed: cambiados, candidates: candidatos.length },
  };
}

// Super Marketing: cola única que encadena follow/unfollow, DM, interacción y
// comentarios sobre cada objetivo. Es el script que absorbió Boost Users,
// Boost Posts, Mass DM y Mass Comment en la app original.
async function superMarketing(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const source = String(p.data_source || 'usernames').toLowerCase();
  const targets = toList(p.targets ?? p.usernames ?? p.urls ?? p.post_urls);
  if (!targets.length) return { success: false, message: 'Falta la lista de objetivos (usuarios o URLs)' };

  const limit = Number(p.consumption_limit ?? 0);
  const lista = limit > 0 ? targets.slice(0, limit) : targets;
  const [gapMin, gapMax] = [Number(p.interval_min_min ?? 0), Number(p.interval_max_min ?? 0)];
  const dmTemplates = toList(p.messages);
  const cmTemplates = toList(p.comments);
  const order = p.template_order || 'random';
  const sender = String(p.sender_username || '');
  const maxPosts = Math.min(Number(p.max_posts ?? 3), 50);
  const skipPosts = Math.min(Number(p.skip_posts ?? 0), 8);
  const [vMin, vMax] = [Number(p.view_min_sec ?? 3), Number(p.view_max_sec ?? 20)];

  const stats = { targets: 0, followed: 0, unfollowed: 0, dm: 0, liked: 0, favorited: 0, reposted: 0, shared: 0, commented: 0 };
  let ti = 0, ci = 0;

  for (const target of lista) {
    stats.targets++;

    if (source === 'urls') {
      await ui.openUrl(target, pkg);
    } else if (!await ui.openProfile(target, p.open_method, pkg)) {
      continue;
    }

    // --- acciones sobre el usuario
    if (p.follow) { if (await ui.tapAny(L.follow)) { stats.followed++; await sleep(1200); } }
    if (p.unfollow) {
      if (await ui.tapAny(L.following)) {
        await sleep(1000);
        if (await ui.tapAny(L.unfollow)) { stats.unfollowed++; await sleep(1200); }
      }
    }
    if (p.send_dm && dmTemplates.length && source !== 'urls') {
      if (await ui.tapAny(L.message)) {
        await sleep(2500);
        const txt = decorate(fillVars(pickTemplate(dmTemplates, order, ti++), { username: target, sender_username: sender }), p);
        await ui.type(txt);
        await sleep(700);
        if (!await ui.tapAny(L.send)) await ui.enter();
        stats.dm++;
        await sleep(1500);
        await ui.back();
        await sleep(1200);
      }
    }

    // --- acciones sobre las publicaciones
    const quiereposts = p.like || p.favorite || p.repost || p.share || p.comment;
    if (quiereposts) {
      if (source !== 'urls') {
        // Abre la cuadrícula del perfil saltando las primeras `skipPosts`.
        const rejilla = (await ui.dump()).filter(n => n.bounds && n.bounds.y1 > ui.size().h * 0.4);
        const primera = rejilla[skipPosts];
        if (primera) { await ui.tapXY(primera.cx, primera.cy); await sleep(3000); }
      }

      for (let i = 0; i < maxPosts; i++) {
        await sleep(randInt(vMin, vMax) * 1000);
        const ns = await ui.dump();
        if (p.like)     { await ui.doubleTapLike(); stats.liked++; await sleep(600); }
        if (p.favorite && await ui.tapAny(L.favorite, { ns })) { stats.favorited++; await sleep(600); }
        if (p.repost   && await ui.tapAny(L.repost,  { ns })) { stats.reposted++; await sleep(800); await ui.back(); }
        if (p.share    && await ui.tapAny(L.share,   { ns })) { stats.shared++;   await sleep(800); await ui.back(); }
        if (p.comment && cmTemplates.length && await ui.tapAny(L.comment, { ns })) {
          await sleep(1800);
          await ui.type(decorate(pickTemplate(cmTemplates, order, ci++), p));
          await sleep(700);
          if (!await ui.tapAny(L.post)) await ui.enter();
          stats.commented++;
          await sleep(1200);
          await ui.back();
        }
        if (i < maxPosts - 1) await ui.nextVideo();
      }
    }

    await ui.back();
    if (gapMax > 0) await sleep(randInt(gapMin, gapMax) * 60 * 1000);
    else await sleep(randInt(2000, 6000));
  }

  return {
    success: stats.targets > 0,
    message: `Super Marketing: ${stats.targets} objetivos · ${stats.followed} follows · ${stats.dm} DM · ${stats.liked} likes · ${stats.commented} comentarios`,
    data: stats,
  };
}

// App Package Selection: enumera qué paquetes objetivo hay instalados, incluidos
// los clones que casen con el prefijo indicado.
async function listPackages(ctx, serial, p) {
  const oficiales = [];
  if (p.tiktok !== false) oficiales.push(PACKAGES.tiktok);
  if (p.tiktok_asia) oficiales.push(PACKAGES.tiktok_asia);
  if (p.instagram !== false) oficiales.push(PACKAGES.instagram);

  const salida = String(await ctx.shell(serial, ['pm', 'list', 'packages']).catch(() => ''));
  const instalados = salida.split(/\r?\n/)
    .map(l => l.replace(/^package:/, '').trim())
    .filter(Boolean);

  const encontrados = oficiales.filter(pkg => instalados.includes(pkg));
  const prefijo = String(p.clone_prefix || '').trim();
  const clones = prefijo ? instalados.filter(pkg => pkg.startsWith(prefijo) && !encontrados.includes(pkg)) : [];

  return {
    success: encontrados.length + clones.length > 0,
    message: encontrados.length + clones.length
      ? `Paquetes objetivo presentes: ${[...encontrados, ...clones].join(', ')}`
      : 'Ninguno de los paquetes objetivo está instalado en este dispositivo',
    data: { official: encontrados, clones, total: encontrados.length + clones.length },
  };
}

// Login: la doc fija el orden email+contraseña primero y usuario+contraseña como
// respaldo, y admite "contraseña:secreto_2fa" para cuentas con TOTP.
async function login(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const email = String(p.email || '').trim();
  const username = String(p.username || '').replace(/^@/, '').trim();
  const bruto = String(p.password || '');
  const [password, totpSecret] = bruto.includes(':') ? bruto.split(':') : [bruto, ''];
  const identificador = email || username;
  if (!identificador || !password) return { success: false, message: 'Faltan credenciales (email/usuario y contraseña)' };

  await ui.openApp(pkg);
  await ui.tapAny(L.profile);
  await sleep(2500);

  // Pantalla de acceso: la vía por email/usuario está detrás de "Usar teléfono / correo / usuario".
  await ui.tapAny(['Usar teléfono / correo electrónico / nombre de usuario', 'Use phone / email / username',
                   'Iniciar sesión', 'Log in', 'Sign in']);
  await sleep(2000);
  await ui.tapAny(['Correo electrónico / nombre de usuario', 'Email / Username', 'Correo', 'Email']);
  await sleep(1500);

  const ns = await ui.dump();
  const campos = ns.filter(n => n.bounds && /EditText/i.test(n.id + n.desc + n.text));
  const campoUsuario = campos[0] || ui.find(ns, ['Correo electrónico', 'Email', 'Usuario', 'Username']);
  if (campoUsuario) { await ui.tapXY(campoUsuario.cx, campoUsuario.cy); await sleep(700); await ui.type(identificador); }

  await sleep(600);
  const ns2 = await ui.dump();
  const campoPass = ns2.filter(n => n.bounds && /EditText/i.test(n.id + n.desc + n.text))[1]
                 || ui.find(ns2, ['Contraseña', 'Password']);
  if (campoPass) { await ui.tapXY(campoPass.cx, campoPass.cy); await sleep(700); await ui.type(password); }

  await sleep(600);
  if (!await ui.tapAny(['Iniciar sesión', 'Log in', 'Acceder', 'Sign in'])) await ui.enter();
  await sleep(6000);

  if (totpSecret) {
    // El código TOTP lo genera el módulo de cuentas que ya existe en el proyecto.
    let codigo = '';
    try { const accounts = require('../server/accounts'); codigo = accounts.totp(totpSecret); } catch (_) {}
    if (codigo) {
      await ui.type(codigo);
      await sleep(500);
      if (!await ui.tapAny(['Siguiente', 'Next', 'Verificar', 'Verify'])) await ui.enter();
      await sleep(5000);
    }
  }

  await ui.dismissPopups();
  const final = await ui.dump();
  const suspendida = final.some(n => /suspendid|suspended|banned|desactivad/i.test(`${n.text} ${n.desc}`));
  if (suspendida) return { success: false, message: 'Cuenta suspendida: se detiene el login', data: { suspended: true } };

  const dentro = !!ui.find(final, L.profile) || !ui.find(final, ['Iniciar sesión', 'Log in']);
  return {
    success: dentro,
    message: dentro
      ? `Sesión iniciada con ${identificador}`
      : 'No se pudo confirmar el inicio de sesión (TikTok suele pedir verificación manual)',
    data: { identificador, totp: !!totpSecret },
  };
}

// Switch Account: cambia a otra cuenta ya presente en el teléfono.
async function switchAccount(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const objetivo = String(p.username || '').replace(/^@/, '').trim();

  await ui.openApp(pkg);
  if (!await ui.tapAny(L.profile)) return { success: false, message: 'No se encontró la pestaña de perfil' };
  await sleep(2500);
  if (!await ui.tapAny(['Cambiar cuenta', 'Switch account', 'Cuentas', 'Accounts'])) {
    return { success: false, message: 'No se encontró el selector de cuentas' };
  }
  await sleep(2000);

  const ns = await ui.dump();
  let destino = null;
  if (objetivo) {
    destino = ns.find(n => n.bounds && new RegExp(`@?${objetivo}\\b`, 'i').test(`${n.text} ${n.desc}`));
    if (!destino) { await ui.back(); return { success: false, message: `La cuenta @${objetivo} no está en este dispositivo` }; }
  } else {
    // Sin objetivo: la siguiente cuenta de la lista que no sea la activa.
    const cuentas = ns.filter(n => n.bounds && /@[A-Za-z0-9._]{2,24}/.test(`${n.text} ${n.desc}`));
    destino = cuentas[1] || cuentas[0];
    if (!destino) { await ui.back(); return { success: false, message: 'No hay otras cuentas en el dispositivo' }; }
  }

  await ui.tapXY(destino.cx, destino.cy);
  await sleep(4000);
  await ui.dismissPopups();
  const etiqueta = (`${destino.text} ${destino.desc}`.match(/@([A-Za-z0-9._]{2,24})/) || [])[1] || 'siguiente';
  return { success: true, message: `Cuenta cambiada a @${etiqueta}`, data: { username: etiqueta } };
}

// Publish Post: sube y publica con pie de foto, según los métodos de la doc.
async function publishPost(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const captions = toList(p.captions ?? p.caption);
  const caption = decorate(pickTemplate(captions, p.caption_order || 'random', Number(p.index ?? 0)), p);
  const metodo = String(p.method || 'plus').toLowerCase();
  const espera = Number(p.upload_wait_sec ?? 15);

  await ui.openApp(pkg);

  if (metodo === 'sound') {
    // "Use Sound via Search": busca el sonido y publica desde su página.
    const sonido = String(p.sound_name || '').trim();
    if (!sonido) return { success: false, message: 'Falta el nombre o la URL del sonido' };
    if (!await ui.tapAny(L.search)) return { success: false, message: 'No se encontró el buscador' };
    await sleep(1200);
    await ui.type(sonido);
    await ui.enter();
    await sleep(3000);
    await ui.tapAny(['Sonidos', 'Sounds', 'Audio']);
    await sleep(2000);
    await ui.tapAny(['Usar este sonido', 'Use this sound']);
    await sleep(3000);
  } else {
    // "Add Button (+)": el botón central de la barra inferior.
    const { w, h } = ui.size();
    await ui.tapXY(w * 0.5, h * 0.96);
    await sleep(3000);
  }

  // Galería -> primer elemento.
  await ui.tapAny(['Subir', 'Upload', 'Galería', 'Gallery', 'Álbum', 'Album']);
  await sleep(2500);
  const { w, h } = ui.size();
  await ui.tapXY(w * 0.17, h * 0.30);
  await sleep(1500);
  await ui.tapAny(L.next);
  await sleep(espera * 1000);        // espera de subida configurable (5-60 s en la doc)
  await ui.tapAny(L.next);
  await sleep(2500);

  if (caption) {
    const ns = await ui.dump();
    const campo = ns.find(n => n.bounds && /EditText/i.test(n.id + n.desc))
               || ui.find(ns, ['Describe tu vídeo', 'Describe your video', 'Añadir descripción', 'Add description']);
    if (campo) { await ui.tapXY(campo.cx, campo.cy); await sleep(1000); await ui.type(caption); await sleep(800); }
  }

  if (p.save_draft) {
    const ok = await ui.tapAny(['Borradores', 'Drafts', 'Guardar borrador', 'Save draft']);
    return { success: ok, message: ok ? 'Guardado como borrador' : 'No se encontró la opción de borrador' };
  }

  const publicado = await ui.tapAny(L.post);
  await sleep(3000);
  return {
    success: publicado,
    message: publicado ? `Publicación enviada: "${caption.slice(0, 30)}"` : 'No se encontró el botón de publicar',
    data: { caption, method: metodo },
  };
}

// Follow Back: devuelve el seguimiento a quien te sigue y aún no sigues.
async function followBack(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const max = Number(p.max_follow ?? 20);

  await ui.openApp(pkg);
  if (!await ui.tapAny(L.profile)) return { success: false, message: 'No se encontró la pestaña de perfil' };
  await sleep(2500);
  if (!await ui.tapAny(L.followers)) return { success: false, message: 'No se encontró la lista de seguidores' };
  await sleep(2500);

  let hechos = 0, seco = 0;
  while (hechos < max && seco < 3) {
    // Solo los que dicen "Seguir": quien ya sale como "Siguiendo" o "Amigos" se
    // deja en paz, si no el toque lo dejaría de seguir.
    const botones = ui.findAll(await ui.dump(), L.follow)
      .filter(n => !/siguiendo|following|amigos|friends/i.test(`${n.text} ${n.desc}`));
    if (!botones.length) { seco++; await ui.scrollList(); continue; }
    seco = 0;
    for (const b of botones) {
      if (hechos >= max) break;
      await ui.tapXY(b.cx, b.cy);
      hechos++;
      await sleep(randInt(900, 2000));
    }
    if (hechos < max) await ui.scrollList();
  }

  return { success: hechos > 0, message: `Devuelto el seguimiento a ${hechos} seguidores (límite ${max})`, data: { followed: hechos } };
}

// Unfollow All: recorre la lista de seguidos pulsando "Siguiendo" -> confirmar.
async function unfollowAll(ctx, serial, p, ui) {
  const { sleep } = ctx;
  const pkg = pkgFor(p);
  const max = Number(p.limit ?? p.max_unfollow ?? 20);

  await ui.openApp(pkg);
  if (!await ui.tapAny(L.profile)) return { success: false, message: 'No se encontró la pestaña de perfil' };
  await sleep(2500);
  if (!await ui.tapAny(L.following)) return { success: false, message: 'No se encontró la lista de seguidos' };
  await sleep(2500);

  let hechos = 0, seco = 0;
  while (hechos < max && seco < 3) {
    const botones = ui.findAll(await ui.dump(), L.following);
    if (!botones.length) { seco++; await ui.scrollList(); continue; }
    seco = 0;
    for (const b of botones) {
      if (hechos >= max) break;
      await ui.tapXY(b.cx, b.cy);
      await sleep(900);
      await ui.tapAny(L.unfollow);       // hoja de confirmación, si aparece
      hechos++;
      await sleep(randInt(800, 1800));
    }
    if (hechos < max) await ui.scrollList();
  }

  return { success: hechos > 0, message: `Dejadas de seguir ${hechos} cuentas (límite ${max})`, data: { unfollowed: hechos } };
}

// Test Script: comprobación sin efectos secundarios. Antes de lanzar un warmup de
// media hora conviene saber si el teléfono responde, si la app está y si el
// volcado de UI funciona, que es de lo que dependen todos los demás scripts.
async function testScript(ctx, serial, p, ui) {
  const pkg = pkgFor(p);
  const informe = {};

  const paquetes = String(await ctx.shell(serial, ['pm', 'list', 'packages']).catch(() => ''));
  informe.app_instalada = paquetes.includes(pkg);

  const nodos = await ui.dump();

  // Después del volcado: es entonces cuando se conoce el espacio de coordenadas
  // real, que no coincide con el tamaño registrado del dispositivo.
  const { w, h } = ui.size();
  informe.resolucion = `${w}x${h}`;
  informe.nodos_ui = nodos.length;
  informe.uiautomator = nodos.length > 0;

  const enPantalla = nodos.filter(n => n.text).slice(0, 5).map(n => n.text);
  informe.textos_visibles = enPantalla;

  const idioma = String(await ctx.shell(serial, ['getprop', 'persist.sys.locale']).catch(() => '')).trim()
              || String(await ctx.shell(serial, ['getprop', 'ro.product.locale']).catch(() => '')).trim();
  informe.idioma = idioma || 'desconocido';
  // Los scripts localizan por texto en español e inglés: otro idioma no fallará
  // ruidosamente, simplemente no encontrará los controles.
  informe.idioma_soportado = /^(es|en)/i.test(idioma);

  const problemas = [];
  if (!informe.app_instalada) problemas.push(`${pkg} no está instalada`);
  if (!informe.uiautomator) problemas.push('uiautomator no devuelve nodos');
  if (!informe.idioma_soportado) problemas.push(`idioma "${informe.idioma}": las etiquetas buscadas son ES/EN`);

  return {
    success: problemas.length === 0,
    message: problemas.length
      ? `Comprobación con avisos: ${problemas.join(' · ')}`
      : `Dispositivo listo · ${informe.resolucion} · ${informe.nodos_ui} nodos de UI · idioma ${informe.idioma}`,
    data: informe,
  };
}

// --------------------------------------------------------------- despachador

// Resuelve los paquetes objetivo (App Package Selection). La doc indica que se
// genera una tarea independiente por cada paquete que case, clones incluidos.
async function resolverPaquetes(ctx, serial, p) {
  const pedidos = [];
  if (p.pkg_tiktok !== false) pedidos.push(PACKAGES.tiktok);
  if (p.pkg_tiktok_asia) pedidos.push(PACKAGES.tiktok_asia);
  if (p.pkg_instagram) pedidos.push(PACKAGES.instagram);
  const prefijo = String(p.clone_prefix || '').trim();

  if (!pedidos.length && !prefijo) return [pkgFor(p)];

  const salida = String(await ctx.shell(serial, ['pm', 'list', 'packages']).catch(() => ''));
  const instalados = salida.split(/\r?\n/).map(l => l.replace(/^package:/, '').trim()).filter(Boolean);

  const presentes = pedidos.filter(x => instalados.includes(x));
  const clones = prefijo ? instalados.filter(x => x.startsWith(prefijo)) : [];
  const total = [...new Set([...presentes, ...clones])];
  return total.length ? total : [pkgFor(p)];
}

// Despacho de un script concreto, ya con el paquete resuelto.
function ejecutarScript(ctx, serial, command, p, ui) {
  switch (command) {
    case 'TIKTOK_LOGIN':             return login(ctx, serial, p, ui);
    case 'TIKTOK_SWITCH_ACCOUNT':    return switchAccount(ctx, serial, p, ui);
    case 'TIKTOK_PUBLISH_POST':      return publishPost(ctx, serial, p, ui);
    case 'TIKTOK_FOLLOW_BACK':       return followBack(ctx, serial, p, ui);
    case 'TIKTOK_UNFOLLOW_ALL':      return unfollowAll(ctx, serial, p, ui);
    case 'TIKTOK_TEST_SCRIPT':       return testScript(ctx, serial, p, ui);
    case 'TIKTOK_ACCOUNT_WARMUP':    return accountWarmup(ctx, serial, p, ui);
    case 'TIKTOK_FILL_PROFILE':      return fillProfile(ctx, serial, p, ui);
    case 'TIKTOK_MATCH_ACCOUNTS':    return matchAccounts(ctx, serial, p, ui);
    case 'TIKTOK_SCRAPE_USERS':      return scrapeUsers(ctx, serial, p, ui);
    case 'TIKTOK_FOLLOW_SUGGESTED':  return followSuggested(ctx, serial, p, ui);
    case 'TIKTOK_MASS_DM':           return massDm(ctx, serial, p, ui);
    case 'TIKTOK_MASS_COMMENT':      return massComment(ctx, serial, p, ui);
    case 'TIKTOK_BOOST_POSTS':       return boostPosts(ctx, serial, p, ui);
    case 'TIKTOK_BOOST_LIVES':       return boostLives(ctx, serial, p, ui);
    case 'TIKTOK_BOOST_COMMENTS':    return boostComments(ctx, serial, p, ui);
    case 'TIKTOK_DELETE_POSTS':      return deletePosts(ctx, serial, p, ui);
    case 'TIKTOK_PRIVACY_SETTINGS':  return privacySettings(ctx, serial, p, ui);
    case 'TIKTOK_SUPER_MARKETING':   return superMarketing(ctx, serial, p, ui);
    case 'TIKTOK_LIST_PACKAGES':     return listPackages(ctx, serial, p);
    default:
      return { success: false, message: `Script de TikTok no soportado: ${command}` };
  }
}

// Envoltura con el bloque de opciones que TikMatrix muestra en TODOS sus diálogos
// de script, y que no aparece en las páginas de documentación de cada script:
// intervalo de tarea, rotación de proxy previa, selección de paquete (con clones)
// y cierre de la app al terminar.
async function run(ctx, serial, command, p) {
  const ui = makeUi(ctx, serial);

  // 1. Task Interval: espera aleatoria dentro del rango antes de arrancar, para
  //    que varios dispositivos no entren todos a la vez.
  const iMin = Number(p.task_interval_min ?? 0);
  const iMax = Number(p.task_interval_max ?? 0);
  if (iMax > 0) {
    const espera = randInt(Math.min(iMin, iMax), iMax);
    if (espera > 0) await ctx.sleep(espera * 60 * 1000);
  }

  // 2. Rotate proxy: nueva IP antes de la tarea. Reutiliza el comando que ya
  //    existe en el transporte en vez de duplicar la lógica de rotación.
  let rotacion = null;
  if (p.rotate_proxy && ctx.execute) {
    rotacion = await ctx.execute(serial, 'TIKTOK_ROTATE_PROXY', {}).catch(e => ({ success: false, message: e.message }));
    if (!rotacion.success) {
      return { success: false, message: `Rotación de proxy fallida, no se ejecuta el script: ${rotacion.message}`, data: { rotacion } };
    }
  }

  // 3. App Package Selection: una pasada por cada paquete objetivo presente.
  const paquetes = await resolverPaquetes(ctx, serial, p);
  const resultados = [];

  for (const pkg of paquetes) {
    let r;
    try {
      r = await ejecutarScript(ctx, serial, command, { ...p, package_name: pkg }, ui);
    } catch (e) {
      r = { success: false, message: e.message };
    }
    resultados.push({ package: pkg, ...r });

    // 4. Close app after task: activado por defecto, como en la app original.
    if (p.close_app_after !== false) {
      await ctx.shell(serial, ['am', 'force-stop', pkg]).catch(() => {});
    }
  }

  if (resultados.length === 1) {
    const r = resultados[0];
    return { ...r, data: { ...(r.data || {}), package: r.package, rotacion } };
  }

  const ok = resultados.filter(r => r.success).length;
  return {
    success: ok > 0,
    message: `${command} en ${resultados.length} paquetes: ${ok} correctos · ` +
             resultados.map(r => `${r.package}: ${r.message}`).join(' | '),
    data: { resultados, rotacion },
  };
}

module.exports = { handles, run, COMMANDS, PACKAGES, spin, toList, pickTemplate, parseCount, fillVars };
