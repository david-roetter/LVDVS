import { ProviderError } from './errors.js';
export { ProviderError };

const defaultBaseUrl = 'https://chat-ai.academiccloud.de/v1';
const defaultTimeoutMs = 15_000;
const defaultMaxResponseBytes = 250_000;

export function hasGwdgConfig() {
  return Boolean(process.env.GWDG_API_KEY && process.env.GWDG_ARCANA_ID);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

async function boundedJson(response, maximumBytes) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ProviderError('GWDG response exceeded the configured size limit.');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError('GWDG returned an unreadable response.');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new ProviderError('GWDG response exceeded the configured size limit.');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8'));
  } catch {
    throw new ProviderError('GWDG returned invalid JSON.');
  }
}

export async function askGwdg({ message, contextPack = {} }) {
  const timeoutMs = boundedInteger(process.env.GWDG_TIMEOUT_MS, defaultTimeoutMs, 1_000, 60_000);
  const maximumBytes = boundedInteger(process.env.GWDG_MAX_RESPONSE_BYTES, defaultMaxResponseBytes, 10_000, 2_000_000);
  let response;
  try {
    response = await fetch(`${process.env.GWDG_BASE_URL || defaultBaseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${process.env.GWDG_API_KEY}`,
        'Content-Type': 'application/json',
        'inference-service': 'saia-openai-gateway'
      },
      body: JSON.stringify({
        model: process.env.GWDG_MODEL || 'qwen3-30b-a3b-instruct-2507',
        messages: [
          {
            role: 'system',
            content: 'You are the Ludus narrative assistant. Separate observations, possible explanations, checks, and next steps. Be imaginative but clearly label uncertainty.'
          },
          {
            role: 'user',
            content: `User request: ${message}\n\nLudus context:\n${JSON.stringify(contextPack)}`
          }
        ],
        temperature: 0.7,
        top_p: 0.1,
        'enable-tools': false,
        arcana: { id: process.env.GWDG_ARCANA_ID }
      })
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new ProviderError('GWDG request timed out.', 504);
    }
    throw new ProviderError('GWDG request failed.');
  }

  if (!response.ok) throw new ProviderError(`GWDG request failed with status ${response.status}`);
  const data = await boundedJson(response, maximumBytes);
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new ProviderError('GWDG returned no usable text.');
  return { text: text.trim() };
}
