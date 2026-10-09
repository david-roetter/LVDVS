#!/usr/bin/env node
// Offline helper for /api/admin/backup files. See MIGRATION.md.
//
//   node scripts/backup-tool.mjs verify      <backup.json>
//   node scripts/backup-tool.mjs signing-key <backup.json>   # prints base64 for LUDUS_SIGNING_KEY
//   node scripts/backup-tool.mjs restore     <backup.json> [--dry-run] [--write-key-file]
//
// restore writes Chronicle files into LUDUS_DATA_DIR. It requires LUDUS_SIGNING_KEY to be set
// and to match the backup, and never overwrites a different existing file. It writes signing-key.pem
// only with --write-key-file (for rolling back to code that reads the key from the data directory).
import { readFile, mkdir, open, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createPublicKey } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sha256, verifyChronicle } from '../src/game/domain.js';
import { parseSigningKey } from '../src/game/store.js';

const namePattern = /^[a-f0-9]{64}\.json$/;

export async function loadBackup(path) {
  const backup = JSON.parse(await readFile(path, 'utf8'));
  if (backup?.format !== 'ludus-backup-v1' || !Array.isArray(backup.chronicles)) throw new Error('Not a ludus-backup-v1 file.');
  const privateKey = parseSigningKey(backup.signing_key_pem);
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  if (backup.signing_public_key_pem && backup.signing_public_key_pem !== publicKey) throw new Error('Backup public key does not match its private key.');
  const problems = [];
  for (const { name, state } of backup.chronicles) {
    if (typeof name !== 'string' || !namePattern.test(name)) { problems.push(`${name}: invalid file name`); continue; }
    if (state?.version !== 1 || !Array.isArray(state.events)) { problems.push(`${name}: unsupported format`); continue; }
    const result = verifyChronicle(state.events, publicKey);
    if (!result.valid) problems.push(`${name}: integrity check failed at event ${result.index}`);
  }
  return { backup, privateKey, publicKey, problems };
}

export async function restoreBackup(path, { dataDir, signingKey, dryRun = false, writeKeyFile = false }) {
  const { backup, privateKey, publicKey, problems } = await loadBackup(path);
  if (problems.length) throw new Error('Backup failed verification:\n' + problems.join('\n'));
  if (!signingKey) throw new Error('Set LUDUS_SIGNING_KEY to the backup key before restoring.');
  if (createPublicKey(parseSigningKey(signingKey)).export({ type: 'spki', format: 'pem' }) !== publicKey) {
    throw new Error('LUDUS_SIGNING_KEY does not match the backup signing key.');
  }
  if (!dataDir) throw new Error('LUDUS_DATA_DIR is not set.');
  const directory = resolve(dataDir);
  if (!dryRun) await mkdir(directory, { recursive: true, mode: 0o700 });
  const summary = { written: 0, unchanged: 0, conflicts: [] };
  for (const { name, state } of backup.chronicles) {
    const target = join(directory, name);
    const contents = JSON.stringify(state);
    try {
      await stat(target);
      if (await readFile(target, 'utf8') === contents) summary.unchanged++;
      else summary.conflicts.push(name);
      continue;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!dryRun) {
      const tmp = target + '.restore.tmp';
      const file = await open(tmp, 'wx', 0o600);
      try { await file.writeFile(contents); await file.sync(); } finally { await file.close(); }
      await rename(tmp, target);
    }
    summary.written++;
  }
  if (writeKeyFile && !dryRun) {
    const keyPath = join(directory, 'signing-key.pem');
    try {
      const existing = await readFile(keyPath, 'utf8');
      if (createPublicKey(existing).export({ type: 'spki', format: 'pem' }) !== publicKey) summary.conflicts.push('signing-key.pem');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const file = await open(keyPath, 'wx', 0o600);
      try { await file.writeFile(privateKey); await file.sync(); } finally { await file.close(); }
    }
  }
  return summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, path, ...flags] = process.argv.slice(2);
  try {
    if (!path) throw new Error('Usage: backup-tool.mjs verify|signing-key|restore <backup.json> [--dry-run] [--write-key-file]');
    if (command === 'verify') {
      const { backup, publicKey, problems } = await loadBackup(path);
      console.log(`${backup.chronicles.length} Chronicles, created ${backup.created_at}`);
      console.log('Signing key fingerprint:', sha256(publicKey).slice(0, 16));
      if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
      console.log('All Chronicles verify against the backup signing key.');
    } else if (command === 'signing-key') {
      const { privateKey } = await loadBackup(path);
      process.stdout.write(Buffer.from(privateKey).toString('base64') + '\n');
    } else if (command === 'restore') {
      const dryRun = flags.includes('--dry-run');
      const summary = await restoreBackup(path, { dataDir: process.env.LUDUS_DATA_DIR, signingKey: process.env.LUDUS_SIGNING_KEY, dryRun, writeKeyFile: flags.includes('--write-key-file') });
      console.log(`${dryRun ? '[dry run] ' : ''}written: ${summary.written}, unchanged: ${summary.unchanged}, conflicts: ${summary.conflicts.length}`);
      if (summary.conflicts.length) { console.error('Different files already exist (left untouched):\n' + summary.conflicts.join('\n')); process.exit(2); }
    } else throw new Error('Unknown command: ' + command);
  } catch (error) { console.error(error.message); process.exit(1); }
}
