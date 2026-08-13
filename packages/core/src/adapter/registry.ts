import anthropic from './anthropic.js';
import openai from './openai.js';
import type { ProviderAdapter } from './provider.js';

const adapters = new Map<string, ProviderAdapter>([
  [anthropic.id, anthropic],
  [openai.id, openai],
]);

const aliases = new Map([
  ['anthropic', 'anthropic-messages'],
  ['openai', 'openai-chat-completions'],
]);

export function normalizeProviderProtocol(id: string): string {
  return aliases.get(id) ?? id;
}

export function getProviderAdapter(id = 'anthropic-messages'): ProviderAdapter {
  const canonical = normalizeProviderProtocol(id);
  const adapter = adapters.get(canonical);
  if (!adapter) throw new Error(`Unsupported API format: ${id}. Available formats: auto, anthropic-messages (anthropic), openai-chat-completions (openai)`);
  return adapter;
}
