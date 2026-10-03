import { ProviderError } from './errors.js';

const defaultBaseUrl = 'https://generativelanguage.googleapis.com/v1beta';
const defaultTimeoutMs = 15_000;
const defaultMaxResponseBytes = 250_000;

export function hasGeminiConfig() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

async function boundedJson(response, maximumBytes) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ProviderError('Gemini response exceeded the configured size limit.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError('Gemini returned an unreadable response.');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new ProviderError('Gemini response exceeded the configured size limit.');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8'));
  } catch {
    throw new ProviderError('Gemini returned invalid JSON.');
  }
}

export async function askGemini({ message, contextPack = {} }) {
  const timeoutMs = boundedInteger(process.env.GEMINI_TIMEOUT_MS, defaultTimeoutMs, 1_000, 60_000);
  const maximumBytes = boundedInteger(process.env.GEMINI_MAX_RESPONSE_BYTES, defaultMaxResponseBytes, 10_000, 2_000_000);
  const baseUrl = (process.env.GEMINI_BASE_URL || defaultBaseUrl).replace(/\/$/, '');
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  let response;
  try {
    response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: 'You are the Ludus narrative assistant. Separate observations, possible explanations, checks, and next steps. Be imaginative but clearly label uncertainty. Never alter or decide deterministic game outcomes.' }]
        },
        contents: [{
          role: 'user',
          parts: [{ text: `User request: ${message}\n\nLudus context:\n${JSON.stringify(contextPack)}` }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: boundedInteger(process.env.GEMINI_MAX_OUTPUT_TOKENS, 768, 64, 4096)
        }
      })
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new ProviderError('Gemini request timed out.', 504);
    }
    throw new ProviderError('Gemini request failed.');
  }

  if (!response.ok) throw new ProviderError(`Gemini request failed with status ${response.status}`);
  const data = await boundedJson(response, maximumBytes);
  const parts = data?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map(part => typeof part?.text === 'string' ? part.text : '').join('').trim() : '';
  if (!text) throw new ProviderError('Gemini returned no usable text.');
  return { text };
}
