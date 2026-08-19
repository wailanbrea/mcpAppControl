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

module.exports = { init, dump, disponible, asegurar, jsonrpc, olvidar, AGENTES_POR_DEFECTO };
