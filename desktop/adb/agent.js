// Lectura de UI a través del agente en el dispositivo (protocolo uiautomator2).
//
// `uiautomator dump` se ejecuta desde el PC y en este parque de teléfonos muere:
// en un SM-G998U con TikTok delante el comando responde literalmente "Killed" y no
// escribe el XML. El sistema mata el proceso por presión de memoria, y en el feed
// además nunca se alcanza el estado "idle" que ese volcado espera.
//
// La solución es leer desde DENTRO del teléfono. El Agente Bsolutions expone la
// jerarquía por HTTP desde su servicio de accesibilidad; los lectores de terceros
// basados en uiautomator2 hacen lo mismo con su propia instrumentación. Este
// módulo habla con cualquiera de los dos —mismo protocolo mínimo: /ping y
// /jsonrpc/0— y deja `uiautomator dump` como último recurso.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// Agentes que sabemos consultar, en orden de preferencia. Cada uno escucha en su
// propio puerto DENTRO del teléfono; el Agente Bsolutions usa el 9009 para no
// pelearse con el lector de terceros si ambos están instalados.
//
// El sufijo .debug existe porque la compilación de depuración del agente lo añade
// a su applicationId: sin listarlo, el agente instalado no se reconocería.
const AGENTES_POR_DEFECTO = [
  { paquete: 'dev.mcp.agent',        puertoRemoto: 9009, propio: true },
  { paquete: 'dev.mcp.agent.debug',  puertoRemoto: 9009, propio: true },
  { paquete: 'com.github.tikmatrix', puertoRemoto: 9008, propio: false },
];

// serial -> { puerto, paquete, puertoRemoto }
const sesiones = new Map();
let siguientePuerto = 9700;
let resolveAdb = () => 'adb';
let agentes = [...AGENTES_POR_DEFECTO];

function init({ adbResolver, agentPackages } = {}) {
  if (adbResolver) resolveAdb = adbResolver;
  if (Array.isArray(agentPackages) && agentPackages.length) {
    agentes = agentPackages.map(a => (typeof a === 'string'
      ? { paquete: a, puertoRemoto: 9009, propio: true }
      : a));
  }
}

function adbCmd(args, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile(resolveAdb(), args, { timeout, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => err ? reject(err) : resolve(String(stdout || '')));
  });
}

async function ping(puerto) {
  try {
    const r = await fetch(`http://127.0.0.1:${puerto}/ping`, { signal: AbortSignal.timeout(3000) });
    return r.ok && /pong/i.test(await r.text());
  } catch (_) { return false; }
}

// Qué agentes de los que sabemos consultar hay realmente en este teléfono.
async function agentesPresentes(serial) {
  const salida = await adbCmd(['-s', serial, 'shell', 'pm', 'list', 'packages']).catch(() => '');
  const instalados = salida.split(/\r?\n/).map(l => l.replace(/^package:/, '').trim());
  return agentes.filter(a => instalados.includes(a.paquete));
}

// Despierta al agente. El propio sirve desde su servicio de accesibilidad, así
// que basta con abrirlo; el de terceros necesita arrancar su instrumentación.
async function arrancarAgente(serial, agente) {
  if (!agente.propio) {
    execFile(resolveAdb(), ['-s', serial, 'shell', 'am', 'instrument', '-w', '-r',
      '-e', 'debug', 'false', '-e', 'class', `${agente.paquete}.stub.Stub`,
      `${agente.paquete}.test/androidx.test.runner.AndroidJUnitRunner`],
      { timeout: 0 }, () => {});
  } else {
    await adbCmd(['-s', serial, 'shell', 'monkey', '-p', agente.paquete,
      '-c', 'android.intent.category.LAUNCHER', '1']).catch(() => {});
  }
  await new Promise(r => setTimeout(r, 2500));
}

// Enlaza un puerto local con el del agente dentro del teléfono.
async function enlazar(serial, puertoLocal, puertoRemoto) {
  await adbCmd(['-s', serial, 'forward', `tcp:${puertoLocal}`, `tcp:${puertoRemoto}`]);
}

// Devuelve el puerto local ya enlazado con un agente que responde.
async function asegurar(serial) {
  const previa = sesiones.get(serial);
  if (previa && await ping(previa.puerto)) return previa.puerto;

  const puerto = previa?.puerto || siguientePuerto++;
  const presentes = await agentesPresentes(serial);
  if (!presentes.length) {
    throw new Error(`ningún agente de UI instalado (se buscaron: ${agentes.map(a => a.paquete).join(', ')})`);
  }

  // Se prueba cada agente presente en orden de preferencia: primero tal cual,
  // y si no contesta se le despierta y se reintenta.
  for (const agente of presentes) {
    try {
      await enlazar(serial, puerto, agente.puertoRemoto);
    } catch (e) {
      continue;   // no se pudo enlazar con este: probar el siguiente
    }
    if (await ping(puerto)) {
      sesiones.set(serial, { puerto, paquete: agente.paquete, puertoRemoto: agente.puertoRemoto });
      return puerto;
    }

    await arrancarAgente(serial, agente);
    if (await ping(puerto)) {
      sesiones.set(serial, { puerto, paquete: agente.paquete, puertoRemoto: agente.puertoRemoto });
      return puerto;
    }
  }

  throw new Error(`ningún agente respondió (probados: ${presentes.map(a => `${a.paquete}:${a.puertoRemoto}`).join(', ')})`);
}

async function jsonrpc(puerto, method, params = [], timeout = 25000) {
  const r = await fetch(`http://127.0.0.1:${puerto}/jsonrpc/0`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) throw new Error(`agente HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`agente: ${j.error.message || JSON.stringify(j.error)}`);
  return j.result;
}

// Jerarquía de la ventana actual, en el mismo XML que produciría `uiautomator dump`.
async function dump(serial) {
  const puerto = await asegurar(serial);
  const xml = await jsonrpc(puerto, 'dumpWindowHierarchy', [false]);
  return typeof xml === 'string' ? xml : '';
}

async function disponible(serial) {
  try { await asegurar(serial); return true; } catch (_) { return false; }
}

function olvidar(serial) { sesiones.delete(serial); }

// ------------------------------------------------ instalación automática

// Los dos paquetes que puede tener el Agente Bsolutions: la compilación de
// depuración añade el sufijo .debug a su applicationId.
const PAQUETES_PROPIOS = ['dev.mcp.agent', 'dev.mcp.agent.debug'];

// Serials a los que ya se intentó instalar en esta sesión. Sin esto, un teléfono
// donde la instalación falla la reintentaría en cada reconexión.
const intentados = new Map();   // serial -> { veces, ultimo }
const MAX_INTENTOS = 2;

// Ruta al APK, configurable; si no, la empaquetada y luego la del repositorio.
const CONFIG_APK = { ruta: null, wsPort: 6011 };

// Se prefiere el APK de release: pesa 2,3 MB frente a 6,3 MB del de depuración
// (R8 recorta el 62%) y su paquete no lleva el sufijo .debug.
function rutaApkAgente() {
  const candidatos = [
    CONFIG_APK.ruta,
    process.resourcesPath && path.join(process.resourcesPath, 'agent', 'mcp-agent.apk'),
    path.resolve(__dirname, '..', 'vendor', 'agent', 'mcp-agent.apk'),
    path.resolve(__dirname, '..', '..', 'android-agent', 'mcp-agent-release.apk'),
    path.resolve(__dirname, '..', '..', 'android-agent', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
  ].filter(Boolean);
  for (const c of candidatos) { try { if (fs.existsSync(c)) return c; } catch (_) {} }
  return null;
}

// Qué hay instalado en el teléfono y en qué estado.
async function estadoEnDispositivo(serial) {
  const salida = await adbCmd(['-s', serial, 'shell', 'pm', 'list', 'packages']).catch(() => '');
  // Comparación por línea exacta, no por subcadena: "dev.mcp.agent" es prefijo de
  // "dev.mcp.agent.debug", así que un includes() daba por instalado el paquete
  // equivocado y luego dumpsys no encontraba su versión.
  const lista = salida.split(/\r?\n/).map(l => l.replace(/^package:/, '').trim());
  const instalado = PAQUETES_PROPIOS.find(p => lista.includes(p)) || null;

  let version = null;
  if (instalado) {
    const info = await adbCmd(['-s', serial, 'shell', 'dumpsys', 'package', instalado]).catch(() => '');
    version = (info.match(/versionName=([^\s]+)/) || [])[1] || null;
  }

  // El servicio de accesibilidad es un permiso que concede la persona en Ajustes:
  // no se puede otorgar desde aquí, así que solo se informa.
  const concedidos = await adbCmd(['-s', serial, 'shell', 'settings', 'get', 'secure',
    'enabled_accessibility_services']).catch(() => '');
  const accesibilidad = !!instalado && concedidos.includes(`${instalado}/`);

  return { instalado, paquete: instalado, version, accesibilidad };
}

// Detecta si al teléfono le falta el agente y lo instala. Devuelve qué pasó, para
// que quien llame pueda informarlo sin volver a consultar.
async function instalarSiFalta(serial) {
  const estado = await estadoEnDispositivo(serial);
  if (estado.instalado) {
    return { accion: 'ya_instalado', ...estado };
  }

  const previo = intentados.get(serial) || { veces: 0 };
  if (previo.veces >= MAX_INTENTOS) {
    return { accion: 'omitido', motivo: `ya se intentó ${previo.veces} veces sin éxito`, ...estado };
  }

  const apk = rutaApkAgente();
  if (!apk) {
    intentados.set(serial, { veces: MAX_INTENTOS, ultimo: Date.now() });
    return { accion: 'sin_apk', motivo: 'no se encontró el APK del Agente Bsolutions', ...estado };
  }

  intentados.set(serial, { veces: previo.veces + 1, ultimo: Date.now() });

  // -g concede de golpe los permisos declarados; la accesibilidad NO entra ahí,
  // por diseño de Android: esa la tiene que activar una persona.
  const salida = await adbCmd(['-s', serial, 'install', '-r', '-g', apk], 240000)
    .catch(e => String(e.message || ''));

  if (!/Success/i.test(salida)) {
    return { accion: 'fallo', motivo: salida.trim().split('\n')[0] || 'instalación rechazada', ...estado };
  }

  intentados.delete(serial);
  const nuevo = await estadoEnDispositivo(serial);
  const aprovisionado = await aprovisionar(serial, nuevo.paquete);
  return { accion: 'instalado', aprovisionado, ...nuevo };
}

// Le dice al agente recién instalado a qué servidor apuntar y con qué serial
// identificarse, lanzándolo con esos datos.
//
// Sin esto se autoasigna un serial propio (device-XXXX) que no coincide con el
// serial ADB, y al conectar aparecería como un SEGUNDO dispositivo en el panel.
// El agente solo acepta estos datos en su primera ejecución, así que esto es
// exactamente el momento.
async function aprovisionar(serial, paquete) {
  if (!paquete) return false;
  try {
    await adbCmd(['-s', serial, 'shell', 'am', 'start',
      '-n', `${paquete}/dev.mcp.agent.MainActivity`,
      '--es', 'server_url', `ws://127.0.0.1:${CONFIG_APK.wsPort}`,
      '--es', 'serial_number', serial], 20000);
    return true;
  } catch (e) {
    console.error(`[agente] no se pudo aprovisionar ${serial}: ${e.message}`);
    return false;
  }
}

function configurarApk({ ruta, wsPort } = {}) {
  if (ruta !== undefined) CONFIG_APK.ruta = ruta || null;
  if (wsPort) CONFIG_APK.wsPort = wsPort;
}

module.exports = {
  init, dump, disponible, asegurar, jsonrpc, olvidar, AGENTES_POR_DEFECTO,
  estadoEnDispositivo, instalarSiFalta, configurarApk, rutaApkAgente, PAQUETES_PROPIOS,
};
