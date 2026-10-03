import { createHash, randomUUID, sign, verify as verifySignature } from 'node:crypto';

export const CLASSES = [
  { id: 'murmillo', name: 'Murmillo', symbol: 'I', gear: 'Sword & shield', description: 'Stand your ground. Let the arena come to you.' },
  { id: 'thraex', name: 'Thraex', symbol: 'II', gear: 'Curved blade', description: 'A precise blade. An unexpected angle.' },
  { id: 'secutor', name: 'Secutor', symbol: 'III', gear: 'Pursuit & pressure', description: 'Close the distance. Keep moving forward.' },
  { id: 'retiarius', name: 'Retiarius', symbol: 'IV', gear: 'Net & trident', description: 'Find your opening in the space between.' },
  { id: 'dimachaerus', name: 'Dimachaerus', symbol: 'V', gear: 'Twin blades', description: 'Two blades. One unbroken rhythm.' }
];
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => canonical(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
export function gameError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}
export function createGladiator(name, gladiatorClass) {
  if (typeof name !== 'string' || !name.trim() || [...name.trim()].length > 32 || /[\x00-\x1f\x7f]/.test(name)) {
    throw gameError('Choose a name between 1 and 32 characters.');
  }
  if (!CLASSES.some((c) => c.id === gladiatorClass)) throw gameError('Choose one of the five gladiator classes.');
  return { id: randomUUID(), name: name.trim(), gladiator_class: gladiatorClass };
}

// CPython Random(int) uses MT19937 init_by_array with least-significant words first.
// Matching it preserves the notebook's winner for identical IDs and seed.
function firstPythonRandomWord(digest) {
  const key = Array.from({ length: 8 }, (_, i) => digest.readUInt32BE(28 - i * 4));
  const mt = new Uint32Array(624);
  mt[0] = 19650218;
  for (let i = 1; i < 624; i++) mt[i] = (Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1812433253) + i) >>> 0;
  let i = 1, j = 0;
  for (let k = 624; k > 0; k--) {
    mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) + key[j] + j) >>> 0;
    if (++i >= 624) { mt[0] = mt[623]; i = 1; }
    if (++j >= key.length) j = 0;
  }
  for (let k = 623; k > 0; k--) {
    mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) - i) >>> 0;
    if (++i >= 624) { mt[0] = mt[623]; i = 1; }
  }
  mt[0] = 0x80000000;
  const y = (mt[0] & 0x80000000) | (mt[1] & 0x7fffffff);
  let value = mt[397] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0);
  value ^= value >>> 11;
  value ^= (value << 7) & 0x9d2c5680;
  value ^= (value << 15) & 0xefc60000;
  value ^= value >>> 18;
  return value >>> 0;
}
export function winnerFor(a, b, seed) {
  const digest = createHash('sha256').update(seed + ':' + a.id + ':' + b.id).digest();
  return firstPythonRandomWord(digest) < 0x80000000 ? a.id : b.id;
}
export function resolveEncounter(a, b, seed, privateKey, requestId = randomUUID()) {
  if (!a || !b || a.id === b.id) throw gameError('Select two different gladiators.');
  if (typeof seed !== 'string' || !seed.trim() || [...seed].length > 120) throw gameError('Enter an encounter seed of 1 to 120 characters.');
  const result = {
    encounter_id: randomUUID(), a, b, seed_commitment: sha256(seed), seed_reveal: seed,
    winner_id: winnerFor(a, b, seed), algorithm: 'python-mt19937-v1', request_id: requestId
  };
  return { ...result, signature: sign(null, Buffer.from(canonical(result)), privateKey).toString('base64') };
}
export function verifyEncounter(result, publicKey) {
  try {
    const { signature, ...signed } = result;
    return signed.algorithm === 'python-mt19937-v1' &&
      signed.a.id !== signed.b.id &&
      sha256(signed.seed_reveal) === signed.seed_commitment &&
      winnerFor(signed.a, signed.b, signed.seed_reveal) === signed.winner_id &&
      verifySignature(null, Buffer.from(canonical(signed)), publicKey, Buffer.from(signature, 'base64'));
  } catch { return false; }
}
export function appendEvent(events, type, payload) {
  const base = {
    index: events.length,
    timestamp: new Date().toISOString().replace('Z', '000+00:00'),
    type, payload, previous_hash: events.at(-1)?.hash || null
  };
  const event = { ...base, hash: sha256(canonical(base)) };
  events.push(event);
  return event;
}

export function appendSignedEvent(events, type, payload, privateKey) {
  const event = appendEvent(events, type, payload);
  event.signature = sign(null, Buffer.from(canonical(event)), privateKey).toString('base64');
  return event;
}
export function verifyChronicle(events, publicKey) {
  if (!Array.isArray(events)) return { valid: false, reason: 'Chronicle must be an event list.', index: 0 };
  let previous = null;
  const signedChronicle = events.length > 0 && typeof events[0]?.signature === 'string';
  const roster = new Map();
  const encounterIds = new Set();
  for (const [index, event] of events.entries()) {
    try {
      const { signature, hash, ...base } = event;
      if (base.index !== index || base.previous_hash !== previous || sha256(canonical(base)) !== hash) {
        return { valid: false, reason: 'Event hash or chain link does not match.', index };
      }
      if ((signedChronicle && typeof signature !== 'string') ||
        (typeof signature === 'string' && !verifySignature(null, Buffer.from(canonical({ ...base, hash })), publicKey, Buffer.from(signature, 'base64')))) {
        return { valid: false, reason: 'Event signature does not match.', index };
      }
      if (base.type === 'gladiator.created') {
        const gladiator = base.payload;
        if (!gladiator.id || roster.has(gladiator.id) || !gladiator.name || !CLASSES.some(c => c.id === gladiator.gladiator_class)) throw new Error();
        roster.set(gladiator.id, gladiator);
      } else if (base.type === 'encounter.resolved') {
        const result = base.payload;
        if (encounterIds.has(result.encounter_id) || !verifyEncounter(result, publicKey) ||
          canonical(roster.get(result.a.id) || null) !== canonical(result.a) ||
          canonical(roster.get(result.b.id) || null) !== canonical(result.b)) {
          return { valid: false, reason: 'Encounter signature, roster, or replay does not match.', index };
        }
        encounterIds.add(result.encounter_id);
      } else if (base.type !== 'player.checked_in') {
        return { valid: false, reason: 'Unknown Chronicle event type.', index };
      }
      previous = hash;
    } catch { return { valid: false, reason: 'Malformed Chronicle event.', index }; }
  }
  return { valid: true, count: events.length, head: previous, encounters: encounterIds.size, signed: signedChronicle };
}
export function prepareCommitment(event) {
  if (!event) throw gameError('Create a Chronicle event first.');
  return { event_hash: event.hash, event_index: event.index, mode: 'dry-run', broadcast: false };
}
