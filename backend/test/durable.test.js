import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { GameStore, parseSigningKey } from '../src/game/store.js';
import { restoreBackup } from '../scripts/backup-tool.mjs';

const newKey = () => generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
async function tempDir(t, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('signing key from the environment survives a wiped data directory', async (t) => {
  const key = newKey();
  const first = await tempDir(t, 'lvdvs-key-a-');
  const store = new GameStore(first, { signingKey: Buffer.from(key).toString('base64') });
  const session = await store.createSession();
  assert.deepEqual(store.signingKeyInfo().source, 'environment');
  assert.ok(!(await readdir(first)).includes('signing-key.pem'), 'environment key is not written to disk');
  const second = new GameStore(await tempDir(t, 'lvdvs-key-b-'), { signingKey: key });
  await second.ready;
  assert.equal(second.publicKey, session.signing_public_key);
  assert.equal(second.signingKeyInfo().fingerprint, store.signingKeyInfo().fingerprint);
});

test('accepts PEM with literal \\n and rejects non-Ed25519 or invalid keys', () => {
  const key = newKey();
  assert.equal(parseSigningKey(key.replace(/\n/g, '\\n')), key);
  const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.throws(() => parseSigningKey(rsa), /Ed25519/);
  assert.throws(() => parseSigningKey('not a key'), /valid PEM/);
});

test('refuses to start when the environment key differs from a key file on disk', async (t) => {
  const directory = await tempDir(t, 'lvdvs-key-c-');
  await writeFile(join(directory, 'signing-key.pem'), newKey());
  await assert.rejects(new GameStore(directory, { signingKey: newKey() }).ready, /does not match/);
});

test('LUDUS_REQUIRE_SIGNING_KEY refuses to generate a throwaway key', async (t) => {
  const directory = await tempDir(t, 'lvdvs-key-d-');
  await assert.rejects(new GameStore(directory, { signingKey: '', requireSigningKey: true }).ready, /LUDUS_SIGNING_KEY is required/);
  assert.deepEqual(await readdir(directory), []);
});

test('backup snapshot restores onto an empty disk and keeps sessions playable', async (t) => {
  const source = new GameStore(await tempDir(t, 'lvdvs-old-'), { signingKey: '' });
  const session = await source.createSession();
  await source.createGladiator(session.token, { name: 'Aelia', gladiator_class: 'murmillo' });
  const backupPath = join(await tempDir(t, 'lvdvs-backup-'), 'backup.json');
  const snapshot = await source.backupSnapshot();
  await writeFile(backupPath, JSON.stringify(snapshot));

  const disk = await tempDir(t, 'lvdvs-disk-');
  await assert.rejects(restoreBackup(backupPath, { dataDir: disk, signingKey: newKey() }), /does not match/);
  assert.deepEqual(await restoreBackup(backupPath, { dataDir: disk, signingKey: snapshot.signing_key_pem, dryRun: true }), { written: 1, unchanged: 0, conflicts: [] });
  assert.deepEqual(await readdir(disk), []);
  assert.deepEqual(await restoreBackup(backupPath, { dataDir: disk, signingKey: snapshot.signing_key_pem }), { written: 1, unchanged: 0, conflicts: [] });
  assert.deepEqual(await restoreBackup(backupPath, { dataDir: disk, signingKey: snapshot.signing_key_pem, writeKeyFile: true }), { written: 0, unchanged: 1, conflicts: [] });
  const rollback = new GameStore(disk, { signingKey: '' });
  assert.equal((await rollback.state(session.token)).verification.valid, true, 'code without LUDUS_SIGNING_KEY reads the same key from disk');

  const migrated = new GameStore(disk, { signingKey: Buffer.from(snapshot.signing_key_pem).toString('base64'), requireSigningKey: true });
  const state = await migrated.state(session.token);
  assert.equal(state.verification.valid, true);
  assert.equal(state.gladiators[0].name, 'Aelia');
  await migrated.createGladiator(session.token, { name: 'Felix', gladiator_class: 'retiarius' });
});

test('restore refuses a tampered backup', async (t) => {
  const source = new GameStore(await tempDir(t, 'lvdvs-old-'), { signingKey: '' });
  const session = await source.createSession();
  await source.createGladiator(session.token, { name: 'Aelia', gladiator_class: 'murmillo' });
  const snapshot = await source.backupSnapshot();
  snapshot.chronicles[0].state.events[0].payload.name = 'Forged';
  const backupPath = join(await tempDir(t, 'lvdvs-backup-'), 'backup.json');
  await writeFile(backupPath, JSON.stringify(snapshot));
  await assert.rejects(restoreBackup(backupPath, { dataDir: await tempDir(t, 'lvdvs-disk-'), signingKey: snapshot.signing_key_pem }), /failed verification/);
});
