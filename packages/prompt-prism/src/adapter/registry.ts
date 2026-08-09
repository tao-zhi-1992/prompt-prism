import anthropic from './anthropic.js';
import type { ProviderAdapter } from './provider.js';

const adapters = new Map<string, ProviderAdapter>([[anthropic.id, anthropic]]);

export function getProviderAdapter(id = 'anthropic'): ProviderAdapter {
  const adapter = adapters.get(id);
  if (!adapter) throw new Error(`Unsupported API format: ${id}. Available formats: ${[...adapters.keys()].join(', ')}`);
  return adapter;
}
