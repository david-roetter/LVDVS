import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

test('browser, game API, recovery rotation, and protected endpoints work together', { timeout: 30_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lvdvs-api-'));
  process.env.LUDUS_DATA_DIR = directory;
  process.env.LUDUS_AI_ENABLED = 'false';
  delete process.env.LUDUS_BACKUP_TOKEN;
  const { server } = await import('../src/server.js');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (path, { token, body, method } = {}) => {
    const response = await fetch(base + path, {
      signal: AbortSignal.timeout(5_000),
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const page = await fetch(base + '/', { signal: AbortSignal.timeout(5_000) });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /LVDVS · Chronicle/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await api('/health')).body.status, 'ok');
  assert.equal((await api('/ready')).body.storage, 'available');
  assert.equal((await api('/api/admin/backup')).status, 401);
  assert.equal((await api('/api/assistant', { body: { message: 'Hello' } })).status, 503);
  assert.equal((await api('/api/game/state')).status, 401);
  assert.equal((await api('/api/peachex/status')).body.payments_enabled, false);
  assert.equal((await api('/api/game/peachex/prepare', {body:{}})).status, 401);
  const created = await api('/api/game/session', { method: 'POST' });
  assert.equal(created.status, 201);
  const token = created.body.token;
  const recruit = body => api('/api/game/gladiators', { token, body });
  assert.equal((await recruit({ name: 'Aelia', gladiator_class: 'murmillo' })).status, 201);
  const roster = await recruit({ name: 'Felix', gladiator_class: 'retiarius' });
  const battle = await api('/api/game/encounters', { token, body: {
    a_id: roster.body.gladiators[0].id, b_id: roster.body.gladiators[1].id,
    seed: 'api-check', request_id: randomUUID()
  } });
  assert.equal(battle.status, 200);
  assert.equal(battle.body.verification.valid, true);
  const prepared = await api('/api/game/peachex/prepare', { token, body:{} });
  assert.equal(prepared.body.mode, 'dry-run');
  assert.equal(prepared.body.transaction, null);
  assert.equal(prepared.body.broadcast, false);
  assert.equal(prepared.body.event_hash, '0x' + battle.body.verification.head);
  const exported = await api('/api/game/export', { token });
  assert.deepEqual(exported.body.events, battle.body.events);
  assert.match(exported.headers.get('content-disposition'), /lvdvs-chronicle.json/);
  const edited = structuredClone(exported.body.events);
  edited[0].payload.name = 'Tampered';
  assert.equal((await api('/api/game/verify', { token, body: { events: edited } })).body.valid, false);
  const rotated = await api('/api/game/session/rotate', { token, body: {} });
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.body.token, token);
  assert.equal((await api('/api/game/state', { token })).status, 401);
  assert.equal((await api('/api/game/state', { token: rotated.body.token })).body.events.length, 3);
  assert.equal((await api('/api/game/session', { token: rotated.body.token, method: 'DELETE' })).body.deleted, true);
  assert.equal((await api('/api/game/state', { token: rotated.body.token })).status, 401);
});
