'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVER_NAME = 'appcontrol';
const MAX_OUTPUT_BYTES = 1024 * 1024;

let runtime = null;

function init(config) {
  runtime = {
    nodeRuntimePath: path.resolve(config.nodeRuntimePath),
    mcpServerPath: path.resolve(config.mcpServerPath),
    tokenFile: path.resolve(config.tokenFile),
    backendUrl: config.backendUrl || 'http://127.0.0.1:8733/api/v1',
    hermesCli: config.hermesCli ? path.resolve(config.hermesCli) : null,
  };
}

function requireRuntime() {
  if (!runtime) throw new Error('La integración Hermes no está inicializada');
  return runtime;
}

function stripAnsi(value) {
  return String(value || '').replace(/\x1B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '');
}

function candidateCliPaths() {
  const local = process.env.LOCALAPPDATA || '';
  return [
    process.env.HERMES_CLI,
    local && path.join(local, 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe'),
    local && path.join(local, 'hermes', 'bin', 'hermes.exe'),
    local && path.join(local, 'Programs', 'Hermes', 'hermes.exe'),
  ].filter(Boolean);
}

function findHermesCli() {
  const configured = requireRuntime().hermesCli;
  if (configured && fs.existsSync(configured)) return configured;
  for (const candidate of candidateCliPaths()) {
    try {
      if (fs.existsSync(candidate)) return path.resolve(candidate);
    } catch (_) {}
  }
  try {
    const output = execFileSync('where.exe', ['hermes'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    const found = output.split(/\r?\n/).map(line => line.trim()).find(Boolean);
    if (found && fs.existsSync(found)) return path.resolve(found);
  } catch (_) {}
  return null;
}

function runCli(cli, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Hermes excedió el tiempo límite (${options.timeoutMs || 45000}ms)`));
    }, options.timeoutMs || 45000);

    const append = (current, chunk) => {
      const next = current + chunk.toString('utf8');
      return next.length > MAX_OUTPUT_BYTES ? next.slice(-MAX_OUTPUT_BYTES) : next;
    };
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        code,
        stdout: stripAnsi(stdout),
        stderr: stripAnsi(stderr),
        output: stripAnsi(`${stdout}\n${stderr}`).trim(),
      });
    });
    child.stdin.end(options.input || '');
  });
}

function configPath() {
  const local = process.env.LOCALAPPDATA || '';
  return local ? path.join(local, 'hermes', 'config.yaml') : null;
}

function snapshotConfig() {
  const file = configPath();
  if (!file || !fs.existsSync(file)) return { file, existed: false, content: null };
  const content = fs.readFileSync(file);
  fs.copyFileSync(file, `${file}.appcontrol.bak`);
  return { file, existed: true, content };
}

function restoreConfig(snapshot) {
  if (!snapshot || !snapshot.file) return;
  if (snapshot.existed) {
    fs.mkdirSync(path.dirname(snapshot.file), { recursive: true });
    fs.writeFileSync(snapshot.file, snapshot.content);
  } else if (fs.existsSync(snapshot.file)) {
    fs.unlinkSync(snapshot.file);
  }
}

function isConfiguredOutput(output) {
  return String(output || '').split(/\r?\n/).some(line =>
    new RegExp(`\\b${SERVER_NAME}\\b`, 'i').test(line) && /enabled/i.test(line),
  );
}

function hasServerOutput(output) {
  return String(output || '').split(/\r?\n/).some(line =>
    new RegExp(`\\b${SERVER_NAME}\\b`, 'i').test(line),
  );
}

function buildAddArgs(config = requireRuntime()) {
  return [
    'mcp', 'add', SERVER_NAME,
    '--connect-timeout', '20',
    '--command', config.nodeRuntimePath,
    '--env',
    `BACKEND_URL=${config.backendUrl}`,
    `BACKEND_TOKEN_FILE=${config.tokenFile}`,
    '--args', config.mcpServerPath,
  ];
}

function validatePortableFiles() {
  const config = requireRuntime();
  if (!fs.existsSync(config.nodeRuntimePath)) {
    throw new Error('El instalador no contiene el runtime MCP privado');
  }
  if (!fs.existsSync(config.mcpServerPath)) {
    throw new Error('El instalador no contiene el servidor MCP de AppControl');
  }
  if (!fs.existsSync(config.tokenFile)) {
    throw new Error('AppControl todavía no ha generado su token local');
  }
}

async function rawStatus() {
  const cli = findHermesCli();
  if (!cli) {
    return {
      installed: false,
      configured: false,
      portable_ready: false,
      message: 'Hermes no está instalado o su CLI no está disponible',
    };
  }
  const list = await runCli(cli, ['mcp', 'list'], { timeoutMs: 15000 });
  return {
    installed: true,
    configured: list.code === 0 && isConfiguredOutput(list.output),
    portable_ready: fs.existsSync(requireRuntime().mcpServerPath),
    cli_path: cli,
    message: list.code === 0 ? 'Hermes detectado' : (list.output || 'No se pudo consultar Hermes'),
  };
}

async function status() {
  try {
    return await rawStatus();
  } catch (error) {
    return {
      installed: !!findHermesCli(),
      configured: false,
      portable_ready: fs.existsSync(requireRuntime().mcpServerPath),
      message: error.message,
    };
  }
}

async function testConnection() {
  const cli = findHermesCli();
  if (!cli) throw new Error('Hermes no está instalado o su CLI no está disponible');
  const result = await runCli(cli, ['mcp', 'test', SERVER_NAME], { timeoutMs: 30000 });
  const toolsMatch = result.output.match(/Tools discovered:\s*(\d+)/i);
  const success = result.code === 0 && /Connected/i.test(result.output);
  return {
    success,
    tools: toolsMatch ? Number(toolsMatch[1]) : 0,
    message: success ? 'Hermes está conectado a AppControl' : (result.output || 'Falló la prueba MCP'),
  };
}

async function configure() {
  validatePortableFiles();
  const cli = findHermesCli();
  if (!cli) throw new Error('Instala Hermes y vuelve a intentar');
  const snapshot = snapshotConfig();
  try {
    const current = await runCli(cli, ['mcp', 'list'], { timeoutMs: 15000 });
    if (current.code === 0 && hasServerOutput(current.output)) {
      const removed = await runCli(cli, ['mcp', 'remove', SERVER_NAME], { timeoutMs: 15000 });
      if (removed.code !== 0) throw new Error(removed.output || 'No se pudo reemplazar la conexión anterior');
    }
    const added = await runCli(cli, buildAddArgs(), { input: 'Y\n', timeoutMs: 45000 });
    if (added.code !== 0 || !/Saved\s+'appcontrol'/i.test(added.output)) {
      throw new Error(added.output || 'Hermes no guardó la conexión MCP');
    }
    const tested = await testConnection();
    if (!tested.success) throw new Error(tested.message);
    return {
      success: true,
      tools: tested.tools,
      message: `Hermes conectado: ${tested.tools || 0} herramientas disponibles. Abre una sesión nueva de Hermes.`,
    };
  } catch (error) {
    restoreConfig(snapshot);
    throw error;
  }
}

async function disconnect() {
  const cli = findHermesCli();
  if (!cli) throw new Error('Hermes no está instalado o su CLI no está disponible');
  const current = await runCli(cli, ['mcp', 'list'], { timeoutMs: 15000 });
  if (current.code === 0 && !hasServerOutput(current.output)) {
    return { success: true, message: 'Hermes ya estaba desconectado de AppControl' };
  }
  const snapshot = snapshotConfig();
  try {
    const result = await runCli(cli, ['mcp', 'remove', SERVER_NAME], { timeoutMs: 15000 });
    if (result.code !== 0) throw new Error(result.output || 'No se pudo desconectar Hermes');
    return { success: true, message: 'Conexión AppControl eliminada de Hermes' };
  } catch (error) {
    restoreConfig(snapshot);
    throw error;
  }
}

module.exports = {
  init,
  status,
  configure,
  testConnection,
  disconnect,
  _buildAddArgs: buildAddArgs,
  _findHermesCli: findHermesCli,
};
