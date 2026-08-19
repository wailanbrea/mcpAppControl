// Lectura de UI a través del agente en el dispositivo (protocolo uiautomator2).
//
// `uiautomator dump` se ejecuta desde el PC y en este parque de teléfonos muere:
// en un SM-G998U con TikTok delante el comando responde literalmente "Killed" y no
// escribe el XML. El sistema mata el proceso por presión de memoria, y en el feed
// además nunca se alcanza el estado "idle" que ese volcado espera.
//
// Por eso TikMatrix instala dos APK en el teléfono (com.github.tikmatrix y su
// .test): son un agente uiautomator2 que corre como instrumentación persistente y
// expone una API JSON-RPC en el puerto 9008. Leyendo por ahí, la misma pantalla
// que hacía fallar el volcado devuelve la jerarquía completa.
//
// Este módulo habla con ese agente y deja `uiautomator dump` como último recurso.

const { execFile } = require('child_process');

// El agente propio de MCP AppControl (dev.mcp.agent) lee la pantalla por
// accesibilidad, pero hoy no expone un comando que devuelva la jerarquía completa:
// solo sabe pulsar por texto o por id. Hasta que lo tenga, aquí se habla con
// cualquier agente compatible con uiautomator2 que haya en el teléfono.
//
// El paquete NO está cableado a propósito: en cuanto dev.mcp.agent publique el
// endpoint de jerarquía, basta con ponerlo el primero en esta lista y el resto
// del código no cambia.
const AGENT_PORT = 9008;
const PAQUETES_POR_DEFECTO = ['dev.mcp.agent', 'com.github.tikmatrix'];

// serial -> { puerto, paquete }
const sesiones = new Map();
let siguientePuerto = 9700;
let resolveAdb = () => 'adb';
let paquetes = [...PAQUETES_POR_DEFECTO];

function init({ adbResolver, agentPackages } = {}) {
  if (adbResolver) resolveAdb = adbResolver;
  if (Array.isArray(agentPackages) && agentPackages.length) paquetes = [...agentPackages];
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

// Qué agentes compatibles hay realmente instalados en este teléfono.
async function paquetesPresentes(serial) {
  const salida = await adbCmd(['-s', serial, 'shell', 'pm', 'list', 'packages']).catch(() => '');
  const instalados = salida.split(/\r?\n/).map(l => l.replace(/^package:/, '').trim());
  return paquetes.filter(p => instalados.includes(p));
}

// Arranca la instrumentación. No se espera a que termine: queda viva sirviendo.
async function arrancarAgente(serial, paquete) {
  execFile(resolveAdb(), ['-s', serial, 'shell', 'am', 'instrument', '-w', '-r',
    '-e', 'debug', 'false', '-e', 'class', `${paquete}.stub.Stub`,
    `${paquete}.test/androidx.test.runner.AndroidJUnitRunner`],
    { timeout: 0 }, () => {});
  await new Promise(r => setTimeout(r, 2500));
}

// Devuelve el puerto local ya enlazado con el agente, arrancándolo si hace falta.
async function asegurar(serial) {
  const previa = sesiones.get(serial);
  if (previa && await ping(previa.puerto)) return previa.puerto;

  const puerto = previa?.puerto || siguientePuerto++;
  try {
    await adbCmd(['-s', serial, 'forward', `tcp:${puerto}`, `tcp:${AGENT_PORT}`]);
  } catch (e) {
    throw new Error(`no se pudo enlazar el puerto del agente: ${e.message}`);
  }
  sesiones.set(serial, { puerto });

  if (await ping(puerto)) return puerto;

  // No responde: levantarlo. Se prueba con cada agente compatible presente,
  // primero por instrumentación y si no abriendo su actividad.
  const presentes = await paquetesPresentes(serial);
  if (!presentes.length) {
    throw new Error(`ningún agente de UI instalado (se buscaron: ${paquetes.join(', ')})`);
  }

  for (const paquete of presentes) {
    await arrancarAgente(serial, paquete);
    if (await ping(puerto)) { sesiones.set(serial, { puerto, paquete }); return puerto; }

    await adbCmd(['-s', serial, 'shell', 'monkey', '-p', paquete,
      '-c', 'android.intent.category.LAUNCHER', '1']).catch(() => {});
    await new Promise(r => setTimeout(r, 2500));
    if (await ping(puerto)) { sesiones.set(serial, { puerto, paquete }); return puerto; }
  }

  throw new Error(`el agente del dispositivo no responde en el puerto ${AGENT_PORT}`);
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

module.exports = { init, dump, disponible, asegurar, jsonrpc, olvidar, PAQUETES_POR_DEFECTO };
