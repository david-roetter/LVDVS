import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { askAi, hasAiProviderConfig, selectedProvider, ProviderError } from './providers/index.js';
import { GameStore } from './game/store.js';
import { CLASSES, gameError, verifyChronicle } from './game/domain.js';
import { PeachExIntegration } from './integrations/peachex.js';

const port = Number(process.env.PORT || 3000);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const maxBodyBytes = 100_000;
const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
let gameStore;
const getGameStore = () => {
  if (!gameStore) {
    if (process.env.NODE_ENV === 'production' && !process.env.LUDUS_DATA_DIR) {
      throw new Error('LUDUS_DATA_DIR is required in production.');
    }
    gameStore = new GameStore(process.env.LUDUS_DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url)));
  }
  return gameStore;
};
const rateBuckets = new Map();
let aiRequestsInFlight = 0;
const peachEx = new PeachExIntegration();

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function aiEnabled() {
  return process.env.LUDUS_AI_ENABLED === 'true';
}

function secureEqual(value, expected) {
  if (typeof value !== 'string' || typeof expected !== 'string') return false;
  const left = Buffer.from(value), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function requestAddress(request) {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = request.headers['x-forwarded-for'];
    const addresses = typeof forwarded === 'string' ? forwarded.split(',').map(value => value.trim()).filter(Boolean) : [];
    const nearest = addresses.at(-1) || '';
    if (nearest.length <= 64 && /^[a-fA-F0-9:.]+$/.test(nearest)) return nearest;
  }
  return request.socket.remoteAddress || 'unknown';
}

function enforceRateLimit(response, key, limit, windowMs) {
  const now = Date.now();
  if (rateBuckets.size > 10_000) {
    for (const [bucketKey, record] of rateBuckets) if (record.expires <= now) rateBuckets.delete(bucketKey);
  }
  const record = rateBuckets.get(key);
  const bucket = !record || record.expires <= now ? { count: 0, expires: now + windowMs } : record;
  bucket.count++;
  rateBuckets.set(key, bucket);
  response.setHeader('RateLimit-Limit', String(limit));
  response.setHeader('RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
  response.setHeader('RateLimit-Reset', String(Math.ceil(bucket.expires / 1000)));
  if (bucket.count > limit) {
    response.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.expires - now) / 1000))));
    throw gameError('Request limit reached. Try again later.', 429);
  }
}

function setSecurityHeaders(response, request) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  response.setHeader('Content-Security-Policy', "base-uri 'self'; frame-ancestors 'none'; object-src 'none'");
  const forwardedProto = process.env.TRUST_PROXY === 'true' ? request.headers['x-forwarded-proto'] : '';
  if (request.socket.encrypted || forwardedProto === 'https') {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

function setCors(response, request) {
  const origin = request.headers.origin;
  const isAllowed = allowedOrigins.includes('*') || (origin && allowedOrigins.includes(origin));
  if (isAllowed) {
    response.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes('*') ? '*' : origin);
  }
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  response.setHeader('Vary', 'Origin');
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(body));
}

async function readBody(request, limit = maxBodyBytes) {
  const contentType = request.headers['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    const error = new Error('Content-Type must be application/json.');
    error.statusCode = 415;
    throw error;
  }

  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    const error = new Error('Request body too large.');
    error.statusCode = 413;
    throw error;
  }
  let data = '';
  for await (const chunk of request) {
    data += chunk;
    if (Buffer.byteLength(data) > limit) {
      const error = new Error('Request body too large.');
      error.statusCode = 413;
      throw error;
    }
  }
  return data ? JSON.parse(data) : {};
}

function validateContextPack(contextPack) {
  return contextPack === undefined || (contextPack !== null && typeof contextPack === 'object' && !Array.isArray(contextPack));
}

export const server = http.createServer(async (request, response) => {
  const requestId = typeof request.headers['x-request-id'] === 'string' && /^[a-zA-Z0-9._-]{8,80}$/.test(request.headers['x-request-id'])
    ? request.headers['x-request-id'] : randomUUID();
  response.setHeader('X-Request-ID', requestId);
  setSecurityHeaders(response, request);
  setCors(response, request);
  if (request.method === 'OPTIONS') return response.writeHead(204).end();

  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/health') {
      return sendJson(response, 200, {
        status: 'ok',
        version: '2.3.0',
        provider: selectedProvider(),
        configured: hasAiProviderConfig(),
        ai_enabled: aiEnabled()
      });
    }
    if (request.method === 'GET' && url.pathname === '/ready') {
      const store = getGameStore();
      await store.ready;
      // Public-key fingerprint only, so operators can confirm a migration kept the same key.
      return sendJson(response, 200, { status: 'ready', storage: 'available', signing_key: store.signingKeyInfo() });
    }
    if (request.method === 'GET' && url.pathname === '/api/peachex/status') {
      enforceRateLimit(response, 'peachex-status:' + requestAddress(request), 20, 60_000);
      return sendJson(response, 200, await peachEx.status());
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/backup') {
      const accessToken = /^Bearer (.+)$/.exec(request.headers.authorization || '')?.[1];
      if (!secureEqual(accessToken, process.env.LUDUS_BACKUP_TOKEN)) {
        return sendJson(response, 401, { error: 'Backup access token required.' });
      }
      enforceRateLimit(response, 'backup:' + requestAddress(request), 6, 60_000);
      return sendJson(response, 200, await getGameStore().backupSnapshot());
    }

    if (url.pathname.startsWith('/api/game/')) {
      if (request.method === 'GET' && url.pathname === '/api/game/classes') return sendJson(response, 200, { classes: CLASSES });
      const store = getGameStore();
      if (request.method === 'POST' && url.pathname === '/api/game/session') {
        enforceRateLimit(response, 'session:' + requestAddress(request), 20, 3_600_000);
        return sendJson(response, 201, await store.createSession());
      }
      const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization || '')?.[1];
      if (!token) throw gameError('Reconnect to your ludus.', 401);
      const isMutation = request.method === 'POST' || request.method === 'DELETE';
      enforceRateLimit(response, (isMutation ? 'write:' : 'read:') + token,
        isMutation ? 120 : 300, 60_000);
      if (request.method === 'GET' && url.pathname === '/api/game/state') return sendJson(response, 200, await store.state(token));
      if (request.method === 'GET' && url.pathname === '/api/game/export') {
        const state = await store.state(token);
        response.setHeader('Content-Disposition', 'attachment; filename="lvdvs-chronicle.json"');
        return sendJson(response, 200, state);
      }
      if (request.method === 'GET' && url.pathname === '/api/game/commitment') return sendJson(response, 200, await store.commitment(token));
      if (request.method === 'DELETE' && url.pathname === '/api/game/session') return sendJson(response, 200, await store.deleteSession(token));
      if (request.method === 'POST') {
        const body = await readBody(request, url.pathname === '/api/game/verify' ? 2_000_000 : 10_000);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw gameError('Send a JSON object.');
        if (url.pathname === '/api/game/peachex/prepare') return sendJson(response, 200, await peachEx.prepare(await store.state(token), body.event_index));
        if (url.pathname === '/api/game/peachex/verify') return sendJson(response, 200, await peachEx.verify(await store.state(token), body.transaction_hash));
        if (url.pathname === '/api/game/peachex/balance') { await store.read(token); return sendJson(response, 200, await peachEx.balance(body.address)); }
        if (url.pathname === '/api/game/session/rotate') return sendJson(response, 200, await store.rotateSession(token));
        if (url.pathname === '/api/game/gladiators') return sendJson(response, 201, await store.createGladiator(token, body));
        if (url.pathname === '/api/game/encounters') return sendJson(response, 200, await store.encounter(token, body));
        if (url.pathname === '/api/game/check-in') return sendJson(response, 200, await store.checkIn(token));
        if (url.pathname === '/api/game/replay') return sendJson(response, 200, await store.replay(token, body.encounter_id));
        if (url.pathname === '/api/game/verify') {
          const state = await store.read(token);
          return sendJson(response, 200, verifyChronicle(body.events ?? state.events, store.publicKey));
        }
      }
      return sendJson(response, 404, { error: 'Game endpoint not found.' });
    }

    if (request.method === 'POST' && (url.pathname === '/api/assistant' || url.pathname === '/narrative')) {
      if (!aiEnabled()) return sendJson(response, 503, { error: 'AI endpoints are disabled.' });
      if (!hasAiProviderConfig()) return sendJson(response, 503, { error: 'AI provider configuration is missing.' });
      const accessToken = /^Bearer (.+)$/.exec(request.headers.authorization || '')?.[1];
      if (!secureEqual(accessToken, process.env.LUDUS_AI_ACCESS_TOKEN)) {
        return sendJson(response, 401, { error: 'AI access token required.' });
      }
      enforceRateLimit(response, 'ai:' + requestAddress(request),
        boundedInteger(process.env.LUDUS_AI_REQUESTS_PER_MINUTE, 10, 1, 120), 60_000);
      const maximumConcurrency = boundedInteger(process.env.LUDUS_AI_MAX_CONCURRENCY, 2, 1, 20);
      if (aiRequestsInFlight >= maximumConcurrency) {
        response.setHeader('Retry-After', '5');
        return sendJson(response, 429, { error: 'AI service is busy. Try again shortly.' });
      }

      const body = await readBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body) || !validateContextPack(body.contextPack)) {
        return sendJson(response, 400, { error: 'Request must be a JSON object with an object contextPack.' });
      }

      const role = typeof body.role === 'string' ? body.role.trim() : '';
      const message = url.pathname === '/narrative'
        ? (role ? `Create an immersive narrative for a ${role} character.` : '')
        : body.message;
      if (typeof message !== 'string' || !message.trim() || message.length > 1000) {
        return sendJson(response, 400, { error: 'message is required and must be 1000 characters or fewer.' });
      }

      aiRequestsInFlight++;
      try {
        const result = await askAi({ message: message.trim(), contextPack: body.contextPack });
        return sendJson(response, 200, url.pathname === '/narrative' ? { narrative: result.text } : result);
      } finally {
        aiRequestsInFlight--;
      }
    }
    if (request.method === 'GET' && !url.pathname.startsWith('/api/') && url.pathname !== '/narrative') {
      const requested = decodeURIComponent(url.pathname === '/' ? '/lite.html' : url.pathname);
      const path = resolve(publicDirectory, '.' + requested);
      if (path.startsWith(resolve(publicDirectory) + sep)) {
        try {
          const bytes = await readFile(path);
          const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
          response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
          return response.end(bytes);
        } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error; }
      }
    }
    return sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    const status = error.statusCode || (error instanceof SyntaxError ? 400 : 500);
    if (status >= 500) {
      console.error(JSON.stringify({ level: 'error', request_id: requestId, method: request.method,
        path: request.url, status, kind: error.name || 'Error' }));
    }
    const message = error instanceof ProviderError
      ? (status === 504 ? 'AI provider request timed out.' : 'AI provider request failed.')
      : (status >= 500 ? 'Internal server error.' : error.message);
    return sendJson(response, status, {
      error: message
    });
  }
});

// Importing the server must not bind a port; tests manage its lifecycle.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(port, () => console.log(`Ludus backend listening on port ${port}`));
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
