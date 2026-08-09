import type { JsonObject, Message, ProviderRequest, ProviderResponse, Usage } from '../types.js';

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function asMessages(value: unknown): Message[] {
  return Array.isArray(value) ? value.filter((item): item is Message => item !== null && typeof item === 'object' && !Array.isArray(item)) : [];
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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
  return { model: typeof parsed.model === 'string' ? parsed.model : null, messages: asMessages(parsed.messages) };
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

export default { parseRequest, parseResponse };
