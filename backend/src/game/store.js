import { chmod, mkdir, readFile, writeFile, rename, open, rm, stat, unlink, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { generateKeyPairSync, randomBytes, randomUUID, createPublicKey } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { appendSignedEvent, createGladiator, gameError, sha256, resolveEncounter, verifyChronicle, prepareCommitment, verifyEncounter } from './domain.js';

const maximumStateBytes = 20_000_000;

function configuredEventLimit() {
  const value = Number(process.env.LUDUS_MAX_EVENTS || 1000);
  return Number.isInteger(value) && value >= 100 && value <= 5000 ? value : 1000;
}

export class GameStore {
  constructor(directory) {
    this.directory = resolve(directory);
    this.queues = new Map();
    this.ready = this.initialize();
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const keyPath = join(this.directory, 'signing-key.pem');
    try { this.privateKey = await readFile(keyPath, 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const keys = generateKeyPairSync('ed25519');
      const pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
      try { await writeFile(keyPath, pem, { flag: 'wx', mode: 0o600 }); this.privateKey = pem; }
      catch (writeError) {
        if (writeError.code !== 'EEXIST') throw writeError;
        this.privateKey = await readFile(keyPath, 'utf8');
      }
    }
    await chmod(keyPath, 0o600);
    this.publicKey = createPublicKey(this.privateKey).export({ type: 'spki', format: 'pem' });
  }
  file(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw gameError('Reconnect to your ludus.', 401);
    return join(this.directory, sha256(token) + '.json');
  }
  async read(token) {
    await this.ready;
    let state;
    try {
      const path = this.file(token);
      if ((await stat(path)).size > maximumStateBytes) throw gameError('The saved Chronicle is too large to read safely.', 409);
      state = JSON.parse(await readFile(path, 'utf8'));
    }
    catch (error) {
      if (error.code === 'ENOENT') throw gameError('This ludus could not be found. Start a new session.', 401);
      if (error instanceof SyntaxError) throw gameError('The saved Chronicle is damaged. Restore it from a trusted backup.', 409);
      throw error;
    }
    if (state?.version !== 1 || typeof state.player_id !== 'string' || typeof state.created_at !== 'string') {
      throw gameError('The saved Chronicle has an unsupported format.', 409);
    }
    const verification = verifyChronicle(state.events, this.publicKey);
    if (!verification.valid) throw gameError('Chronicle integrity check failed at event ' + verification.index + '. No changes were made.', 409);
    return state;
  }
  async save(token, state) {
    const path = this.file(token);
    const tmp = path + '.' + randomUUID() + '.tmp';
    let file;
    try {
      file = await open(tmp, 'wx', 0o600);
      await file.writeFile(JSON.stringify(state));
      await file.sync();
      await file.close();
      file = null;
      await rename(tmp, path);
      await this.syncDirectory();
    } catch (error) {
      if (file) await file.close().catch(() => {});
      await rm(tmp, { force: true }).catch(() => {});
      throw error;
    }
  }
  async syncDirectory() {
    const directory = await open(this.directory, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
  async createSession() {
    await this.ready;
    const token = randomBytes(32).toString('hex');
    const state = { version: 1, player_id: randomUUID(), created_at: new Date().toISOString(), events: [] };
    await this.save(token, state);
    return { token, ...this.view(state) };
  }
  view(state) {
    return {
      version: 1, player_id: state.player_id, signing_public_key: this.publicKey,
      gladiators: state.events.filter(e => e.type === 'gladiator.created').map(e => e.payload),
      encounters: state.events.filter(e => e.type === 'encounter.resolved').map(e => e.payload),
      events: state.events, verification: verifyChronicle(state.events, this.publicKey)
    };
  }
  async state(token) { return this.view(await this.read(token)); }
  async backupSnapshot() {
    await this.ready;
    const names = (await readdir(this.directory)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).sort();
    const chronicles = [];
    for (const name of names) {
      const path = join(this.directory, name);
      const info = await stat(path);
      if (info.size > maximumStateBytes) throw gameError('A saved Chronicle is too large to back up safely.', 409);
      chronicles.push({ name, state: JSON.parse(await readFile(path, 'utf8')) });
    }
    return {
      format: 'ludus-backup-v1',
      created_at: new Date().toISOString(),
      signing_key_pem: this.privateKey,
      signing_public_key_pem: this.publicKey,
      chronicles
    };
  }
  mutate(token, action) {
    const key = sha256(token);
    const previous = this.queues.get(key) || Promise.resolve();
    const operation = previous.then(() => this.withFileLock(token, async () => {
        const state = await this.read(token);
        if (state.events.length >= configuredEventLimit()) throw gameError('This Chronicle is full. Export your history.', 409);
        await action(state);
        await this.save(token, state);
        return this.view(state);
      }));
    const settled = operation.catch(() => {});
    this.queues.set(key, settled);
    operation.then(() => this.queues.get(key) === settled && this.queues.delete(key),
      () => this.queues.get(key) === settled && this.queues.delete(key));
    return operation;
  }
  createGladiator(token, body) {
    return this.mutate(token, (state) => {
      if (state.events.filter(e => e.type === 'gladiator.created').length >= 30) throw gameError('Your ludus can hold 30 gladiators.');
      appendSignedEvent(state.events, 'gladiator.created', createGladiator(body.name, body.gladiator_class), this.privateKey);
    });
  }
  encounter(token, body) {
    return this.mutate(token, (state) => {
      if (typeof body.request_id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(body.request_id)) throw gameError('A request ID is required.');
      const old = state.events.find(e => e.type === 'encounter.resolved' && e.payload.request_id === body.request_id);
      if (old) {
        if (old.payload.a.id !== body.a_id || old.payload.b.id !== body.b_id || old.payload.seed_reveal !== body.seed) throw gameError('Request ID already used with different inputs.', 409);
        return;
      }
      const roster = state.events.filter(e => e.type === 'gladiator.created').map(e => e.payload);
      const a = roster.find(g => g.id === body.a_id), b = roster.find(g => g.id === body.b_id);
      const result = resolveEncounter(a, b, body.seed, this.privateKey, body.request_id);
      appendSignedEvent(state.events, 'encounter.resolved', result, this.privateKey);
    });
  }
  checkIn(token) {
    return this.mutate(token, state => {
      const latest = [...state.events].reverse().find(event => event.type === 'player.checked_in');
      if (latest && Date.now() - Date.parse(latest.timestamp) < 60_000) {
        throw gameError('You already checked in during the last minute.', 429);
      }
      appendSignedEvent(state.events, 'player.checked_in', { method: 'foreground', venue: 'The training ground' }, this.privateKey);
    });
  }
  async replay(token, encounterId) {
    const state = await this.read(token);
    const result = state.events.find(e => e.type === 'encounter.resolved' && e.payload.encounter_id === encounterId)?.payload;
    if (!result) throw gameError('Encounter not found.', 404);
    return { valid: verifyEncounter(result, this.publicKey), winner_id: result.winner_id, encounter_id: result.encounter_id };
  }
  async commitment(token) {
    const state = await this.read(token);
    return prepareCommitment(state.events.at(-1));
  }
  rotateSession(token) {
    return this.exclusive(token, async () => {
      const state = await this.read(token);
      const nextToken = randomBytes(32).toString('hex');
      await rename(this.file(token), this.file(nextToken));
      await this.syncDirectory();
      return { token: nextToken, ...this.view(state) };
    });
  }
  deleteSession(token) {
    return this.exclusive(token, async () => {
      await this.read(token);
      await unlink(this.file(token));
      await this.syncDirectory();
      return { deleted: true };
    });
  }
  exclusive(token, action) {
    const key = sha256(token);
    const previous = this.queues.get(key) || Promise.resolve();
    const operation = previous.then(() => this.withFileLock(token, action));
    const settled = operation.catch(() => {});
    this.queues.set(key, settled);
    operation.then(() => this.queues.get(key) === settled && this.queues.delete(key),
      () => this.queues.get(key) === settled && this.queues.delete(key));
    return operation;
  }
  async withFileLock(token, action) {
    const lockPath = this.file(token) + '.lock';
    const deadline = Date.now() + 5_000;
    let lock;
    while (!lock) {
      try {
        lock = await open(lockPath, 'wx', 0o600);
        await lock.writeFile(JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try {
          const existing = await stat(lockPath);
          if (Date.now() - existing.mtimeMs > 30_000) {
            await rm(lockPath, { force: true });
            continue;
          }
        } catch (statError) {
          if (statError.code === 'ENOENT') continue;
          throw statError;
        }
        if (Date.now() >= deadline) throw gameError('This Chronicle is busy. Try again.', 503);
        await delay(15 + Math.floor(Math.random() * 35));
      }
    }
    try {
      return await action();
    } finally {
      await lock.close().catch(() => {});
      await rm(lockPath, { force: true });
    }
  }
}
