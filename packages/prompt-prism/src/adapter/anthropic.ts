import type { JsonObject, JsonValue, Message, ModelInputSection, ProviderRequest, ProviderResponse, Usage } from '../types.js';
import type { ProviderAdapter } from './provider.js';

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function asMessages(value: unknown): Message[] {
  return Array.isArray(value) ? value.filter((item): item is Message => item !== null && typeof item === 'object' && !Array.isArray(item)) : [];
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function inputIdentity(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(inputIdentity);
  if (value === null || typeof value !== 'object') return value;
  const normalized: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'cache_control' && child !== undefined) normalized[key] = inputIdentity(child);
  }
  return normalized;
}

function normalizeUsage(usage: unknown = {}): Usage {
  const value = asObject(usage);
  return {
    input_tokens: numberValue(value.input_tokens),
    output_tokens: numberValue(value.output_tokens),
    cache_creation_input_tokens: numberValue(value.cache_creation_input_tokens),
    cache_read_input_tokens: numberValue(value.cache_read_input_tokens)
  };
}

export function parseRequest(body: Buffer | string): ProviderRequest {
  const value = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  const parsed = asObject(JSON.parse(value));
  const model = typeof parsed.model === 'string' ? parsed.model : null;
  const messages = asMessages(parsed.messages);
  const options = Object.fromEntries(Object.entries(parsed).filter(([key]) => !['messages', 'system', 'tools'].includes(key))) as JsonObject;
  const sections: ModelInputSection[] = [
    { id: 'messages', label: 'Messages', order: 10, value: messages, compare_as: 'sequence', default_collapsed: false },
    { id: 'system', label: 'System', order: 20, value: (parsed.system ?? null) as JsonValue, compare_as: 'json', default_collapsed: true },
    { id: 'tools', label: 'Tools', order: 30, value: (parsed.tools ?? []) as JsonValue, compare_as: 'json', default_collapsed: true },
    { id: 'options', label: 'Request options', order: 40, value: options, compare_as: 'json', default_collapsed: true },
  ];
  return { model, messages, input: { adapter_id: 'anthropic', primary_section_id: 'messages', primary_sequence: messages.map(inputIdentity), sections } };
}

export function parseResponse(body: Buffer | string, contentType = ''): ProviderResponse {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  if (!/text\/event-stream/i.test(contentType)) {
    try { return { usage: normalizeUsage(asObject(JSON.parse(text)).usage) }; }
    catch { return { usage: normalizeUsage() }; }
  }

  let usage: JsonObject = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const event = asObject(JSON.parse(data));
      const message = asObject(event.message);
      const next = event.usage ?? message.usage;
      if (next) usage = { ...usage, ...asObject(next) };
    } catch { /* Ignore incomplete or non-JSON SSE data lines. */ }
  }
  return { usage: normalizeUsage(usage) };
}

const anthropic: ProviderAdapter = { id: 'anthropic', parseRequest, parseResponse };

export default anthropic;
