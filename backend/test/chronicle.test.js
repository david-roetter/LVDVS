import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GameStore } from '../src/game/store.js';
import { sha256 } from '../src/game/domain.js';

test('Chronicle survives a new store, replays, and deduplicates encounter requests', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lvdvs-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new GameStore(directory);
  const session = await store.createSession();
  await store.createGladiator(session.token, { name: 'Aelia', gladiator_class: 'murmillo' });
  const roster = await store.createGladiator(session.token, { name: 'Felix', gladiator_class: 'retiarius' });
  const input = { a_id: roster.gladiators[0].id, b_id: roster.gladiators[1].id, seed: 'migration-check', request_id: randomUUID() };
  const encounter = await store.encounter(session.token, input);
  const duplicate = await store.encounter(session.token, input);
  assert.equal(duplicate.events.length, 3);
  assert.deepEqual(duplicate.encounters, encounter.encounters);
  await assert.rejects(store.encounter(session.token, { ...input, seed: 'other' }), { statusCode: 409 });
  const reopened = new GameStore(directory);
  const restored = await reopened.state(session.token);
  assert.equal(restored.signing_public_key, session.signing_public_key);
  assert.deepEqual(restored.events, encounter.events);
  assert.equal(restored.verification.valid, true);
  assert.equal(restored.verification.signed, true);
  assert.equal((await reopened.replay(session.token, restored.encounters[0].encounter_id)).valid, true);
  assert.equal((await reopened.commitment(session.token)).broadcast, false);
});

test('modified saved events are rejected before further changes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lvdvs-tamper-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new GameStore(directory);
  const { token } = await store.createSession();
  await store.createGladiator(token, { name: 'Aelia', gladiator_class: 'murmillo' });
  const path = join(directory, sha256(token) + '.json');
  const saved = JSON.parse(await readFile(path, 'utf8'));
  saved.events[0].payload.name = 'Changed';
  await writeFile(path, JSON.stringify(saved));
  await assert.rejects(store.state(token), { statusCode: 409 });
  await assert.rejects(store.createGladiator(token, { name: 'Felix', gladiator_class: 'retiarius' }), { statusCode: 409 });
  assert.equal(JSON.parse(await readFile(path, 'utf8')).events.length, 1);
});
