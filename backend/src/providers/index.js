import { askGwdg, hasGwdgConfig } from './gwdg.js';
import { ProviderError } from './errors.js';
import { askGemini, hasGeminiConfig } from './gemini.js';

export { ProviderError };

export function selectedProvider() {
  const requested = (process.env.LUDUS_AI_PROVIDER || 'auto').trim().toLowerCase();
  if (!['auto', 'gemini', 'gwdg'].includes(requested)) return 'invalid';
  if (requested !== 'auto') return requested;
  if (hasGeminiConfig()) return 'gemini';
  if (hasGwdgConfig()) return 'gwdg';
  return 'none';
}

export function hasAiProviderConfig() {
  const provider = selectedProvider();
  return provider === 'gemini' ? hasGeminiConfig() : provider === 'gwdg' ? hasGwdgConfig() : false;
}

export async function askAi(input) {
  const provider = selectedProvider();
  if (provider === 'gemini') return askGemini(input);
  if (provider === 'gwdg') return askGwdg(input);
  const error = new ProviderError(provider === 'invalid' ? 'Invalid AI provider configuration.' : 'AI provider configuration is missing.');
  throw error;
}
