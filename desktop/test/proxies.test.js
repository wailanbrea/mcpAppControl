'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const accounts = require('../server/accounts');
const dbServer = require('../server/db');
const proxies = require('../server/proxies');

async function setup(t, dispatch) {
  const db = await dbServer.open(':memory:');
  accounts.init(db);
  proxies.init(db, {
    encrypt: accounts._enc,
    decrypt: accounts._dec,
    dispatch,
  });
  t.after(() => db.close());
  return db;
}

function addDevice(db, id, serial) {
  const timestamp = dbServer.now();
  db.run(`
    INSERT INTO devices(id,name,serial_number,adb_serial,transport,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)
  `, [id, serial, serial, serial, 'adb', 'online', timestamp, timestamp]);
  return db.get('SELECT * FROM devices WHERE id=?', [id]);
}

test('proxy pool encrypts secrets and distributes respecting capacity', async t => {
  const commands = [];
  const db = await setup(t, async (serial, command, params) => {
    commands.push({ serial, command, params });
    return { success: true, message: 'ok', data: { proxy: `${params.host}:${params.port}` } };
  });
  const device1 = addDevice(db, 1, 'USB-1');
  const device2 = addDevice(db, 2, 'USB-2');
  const proxy1 = proxies.create({
    name: 'Proxy one',
    host: '10.0.0.1',
    port: 8080,
    username: 'stored-user',
    password: 'stored-secret',
    max_devices: 1,
  });
  const proxy2 = proxies.create({ name: 'Proxy two', host: '10.0.0.2', port: 8080, max_devices: 2 });

  assert.equal(proxy1.has_password, true);
  assert.equal(Object.hasOwn(proxy1, 'password'), false);
  assert.notEqual(db.get('SELECT password_enc FROM proxies WHERE id=?', [proxy1.id]).password_enc, 'stored-secret');

  const authResult = await proxies.assignAndApply(device1, { proxy_id: proxy1.id });
  assert.equal(authResult.success, false);
  assert.match(authResult.message, /no admite autenticación/i);

  proxies.update(proxy1.id, { status: 'active', username: '' });
  db.run('UPDATE proxies SET password_enc=NULL,last_used_at=NULL WHERE id=?', [proxy1.id]);
  const distributed = await proxies.distribute([device1, device2], { strategy: 'round_robin' });
  assert.equal(distributed.assigned, 2);
  assert.equal(proxies.activeAssignment(device1.id).proxy.id, proxy1.id);
  assert.equal(proxies.activeAssignment(device2.id).proxy.id, proxy2.id);
  assert.equal(commands.filter(entry => entry.command === 'SET_PROXY').length, 2);

  const rotated = await proxies.assignAndApply(device1, { strategy: 'round_robin', exclude_current: true });
  assert.equal(rotated.success, true);
  assert.equal(proxies.activeAssignment(device1.id).proxy.id, proxy2.id);
});

test('parallel assignments reserve a single-capacity proxy only once', async t => {
  let releaseDispatch;
  const dispatchGate = new Promise(resolve => { releaseDispatch = resolve; });
  const db = await setup(t, async () => {
    await dispatchGate;
    return { success: true, message: 'ok', data: {} };
  });
  const device1 = addDevice(db, 1, 'USB-A');
  const device2 = addDevice(db, 2, 'USB-B');
  proxies.create({ host: '10.0.1.1', port: 3128, max_devices: 1 });

  const first = proxies.assignAndApply(device1);
  const second = proxies.assignAndApply(device2);
  releaseDispatch();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.success, true);
  assert.equal(secondResult.success, false);
  assert.match(secondResult.message, /no hay proxies disponibles/i);
});
