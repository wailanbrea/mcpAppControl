'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const hermes = require('../server/hermes');

test('Hermes registration uses the bundled private runtime and token file without embedding the token', () => {
  const nodeRuntimePath = path.resolve('C:/Program Files/MCP AppControl/resources/node-runtime/node.exe');
  const mcpServerPath = path.resolve('C:/Program Files/MCP AppControl/resources/mcp-server/appcontrol-mcp.cjs');
  const tokenFile = path.resolve('C:/Users/test/AppData/Roaming/MCP Control Bsolutions V1/api-token.txt');
  hermes.init({
    nodeRuntimePath,
    mcpServerPath,
    tokenFile,
    backendUrl: 'http://127.0.0.1:8733/api/v1',
  });

  const args = hermes._buildAddArgs();
  assert.deepEqual(args.slice(0, 3), ['mcp', 'add', 'appcontrol']);
  assert.equal(args[args.indexOf('--command') + 1], nodeRuntimePath);
  assert.equal(args[args.indexOf('--args') + 1], mcpServerPath);
  assert.equal(args.includes('ELECTRON_RUN_AS_NODE=1'), false);
  assert.equal(args.includes(mcpServerPath), true);
  assert.ok(args.includes(`BACKEND_TOKEN_FILE=${tokenFile}`));
  assert.ok(args.includes('BACKEND_URL=http://127.0.0.1:8733/api/v1'));
  assert.equal(args.join(' ').includes('server-test-token'), false);
});
