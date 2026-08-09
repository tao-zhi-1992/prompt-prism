import type {
  ConversationContentBlock,
  ConversationMessage,
  JsonObject,
  JsonValue,
  Message,
  ModelInputSection,
  ModelOutputBlock,
  ModelOutputSnapshot,
  ProviderError,
  ProviderRequest,
  ProviderResponse,
  Usage,
} from '../types.js';
import type { ProviderAdapter } from './provider.js';

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function asMessages(value: unknown): Message[] {
  return Array.isArray(value) ? value.filter((item): item is Message => item !== null && typeof item === 'object' && !Array.isArray(item)) : [];
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
  const normalized: Usage = {};
  for (const key of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'] as const) {
    const next = value[key];
    if (typeof next === 'number' && Number.isFinite(next)) normalized[key] = next;
  }
  return normalized;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === 'object') {
    const output: JsonObject = {};
    for (const [key, child] of Object.entries(value)) if (child !== undefined) output[key] = toJsonValue(child);
    return output;
  }
  return String(value);
}

function parseProviderError(value: unknown): ProviderError {
  const error = asObject(value);
  return {
    type: stringValue(error.type),
    message: stringValue(error.message) ?? 'Unknown provider error',
    details: toJsonValue(error),
  };
}

function normalizeBlock(value: unknown): ModelOutputBlock {
  const block = asObject(value);
  const providerType = stringValue(block.type) ?? 'unknown';
  if (providerType === 'text') return { type: 'text', text: stringValue(block.text) ?? '' };
  if (providerType === 'thinking') return { type: 'reasoning', text: stringValue(block.thinking) ?? '' };
  if (providerType === 'tool_use') {
    return {
      type: 'tool_call',
      id: stringValue(block.id),
      name: stringValue(block.name) ?? 'Unknown tool',
      input: block.input === undefined ? null : toJsonValue(block.input),
    };
  }
  return { type: 'unknown', provider_type: providerType, value: toJsonValue(block) };
}

function normalizeConversationBlock(value: unknown): ConversationContentBlock {
  if (typeof value === 'string') return { type: 'text', text: value };
  const block = asObject(value);
  const providerType = stringValue(block.type) ?? 'unknown';
  if (providerType === 'text') return { type: 'text', text: stringValue(block.text) ?? '' };
  if (providerType === 'thinking') return { type: 'reasoning', text: stringValue(block.thinking) ?? '' };
  if (providerType === 'tool_use') {
    return {
      type: 'tool_call',
      id: stringValue(block.id),
      name: stringValue(block.name) ?? 'Unknown tool',
      input: block.input === undefined ? null : toJsonValue(block.input),
    };
  }
  if (providerType === 'tool_result') {
    return {
      type: 'tool_result',
      tool_call_id: stringValue(block.tool_use_id),
      content: block.content === undefined ? '' : toJsonValue(block.content),
      is_error: typeof block.is_error === 'boolean' ? block.is_error : null,
    };
  }
  return { type: 'unknown', provider_type: providerType, value: toJsonValue(block) };
}

function normalizeConversation(messages: Message[]): ConversationMessage[] {
  return messages.map((message) => {
    const content = message.content;
    const blocks = Array.isArray(content) ? content.map(normalizeConversationBlock)
      : content === undefined || content === null ? [] : [normalizeConversationBlock(content)];
    return { role: typeof message.role === 'string' ? message.role : 'unknown', content: blocks };
  });
}

function outputFromMessage(message: JsonObject, usage = normalizeUsage(message.usage)): ModelOutputSnapshot {
  const content = Array.isArray(message.content) ? message.content.map(normalizeBlock) : [];
  return {
    adapter_id: 'anthropic',
    id: stringValue(message.id),
    model: stringValue(message.model),
    role: stringValue(message.role),
    stop_reason: stringValue(message.stop_reason),
    content,
    usage,
  };
}

type MutableSseBlock = {
  providerType: string;
  text: string;
  id: string | null;
  name: string;
  input: JsonValue | null;
  inputRaw: string;
  value: JsonValue;
};

function mutableBlock(value: unknown): MutableSseBlock {
  const block = asObject(value);
  const providerType = stringValue(block.type) ?? 'unknown';
  return {
    providerType,
    text: providerType === 'thinking' ? stringValue(block.thinking) ?? '' : stringValue(block.text) ?? '',
    id: stringValue(block.id),
    name: stringValue(block.name) ?? 'Unknown tool',
    input: block.input === undefined ? null : toJsonValue(block.input),
    inputRaw: '',
    value: toJsonValue(block),
  };
}

function finalizedBlock(block: MutableSseBlock): ModelOutputBlock {
  if (block.providerType === 'text') return { type: 'text', text: block.text };
  if (block.providerType === 'thinking') return { type: 'reasoning', text: block.text };
  if (block.providerType === 'tool_use') {
    if (!block.inputRaw) return { type: 'tool_call', id: block.id, name: block.name, input: block.input };
    try { return { type: 'tool_call', id: block.id, name: block.name, input: toJsonValue(JSON.parse(block.inputRaw)) }; }
    catch { return { type: 'tool_call', id: block.id, name: block.name, input: null, input_raw: block.inputRaw }; }
  }
  return { type: 'unknown', provider_type: block.providerType, value: block.value };
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
  return {
    model,
    messages,
    input: {
      adapter_id: 'anthropic',
      primary_section_id: 'messages',
      primary_sequence: messages.map(inputIdentity),
      sections,
      conversation: normalizeConversation(messages),
    },
  };
}

export function parseResponse(body: Buffer | string, contentType = ''): ProviderResponse {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  if (!/text\/event-stream/i.test(contentType)) {
    try {
      const parsed = asObject(JSON.parse(text));
      const usage = normalizeUsage(parsed.usage);
      if (parsed.type === 'error' || parsed.error) {
        return {
          usage,
          output: {
            adapter_id: 'anthropic', id: null, model: null, role: null, stop_reason: null,
            content: [], usage, error: parseProviderError(parsed.error ?? parsed),
          },
        };
      }
      if (parsed.type !== 'message' && !Array.isArray(parsed.content)) return { usage, output: null };
      return { usage, output: outputFromMessage(parsed, usage) };
    } catch { return { usage: {}, output: null }; }
  }

  let usage: JsonObject = {};
  let id: string | null = null;
  let model: string | null = null;
  let role: string | null = null;
  let stopReason: string | null = null;
  let error: ProviderError | undefined;
  let recognized = false;
  const blocks = new Map<number, MutableSseBlock>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const event = asObject(JSON.parse(data));
      const message = asObject(event.message);
      const next = event.usage ?? message.usage;
      if (next) usage = { ...usage, ...asObject(next) };
      const eventType = stringValue(event.type);
      if (eventType === 'message_start') {
        recognized = true;
        id = stringValue(message.id) ?? id;
        model = stringValue(message.model) ?? model;
        role = stringValue(message.role) ?? role;
        stopReason = stringValue(message.stop_reason) ?? stopReason;
        if (Array.isArray(message.content)) message.content.forEach((block, index) => blocks.set(index, mutableBlock(block)));
      } else if (eventType === 'content_block_start') {
        recognized = true;
        const index = typeof event.index === 'number' ? event.index : blocks.size;
        blocks.set(index, mutableBlock(event.content_block));
      } else if (eventType === 'content_block_delta') {
        recognized = true;
        const index = typeof event.index === 'number' ? event.index : blocks.size;
        const delta = asObject(event.delta);
        let block = blocks.get(index);
        if (!block) {
          const deltaType = stringValue(delta.type);
          const inferred = deltaType === 'thinking_delta' ? 'thinking' : deltaType === 'input_json_delta' ? 'tool_use' : deltaType === 'text_delta' ? 'text' : 'unknown';
          block = mutableBlock({ type: inferred });
          blocks.set(index, block);
        }
        if (delta.type === 'text_delta') block.text += stringValue(delta.text) ?? '';
        else if (delta.type === 'thinking_delta') block.text += stringValue(delta.thinking) ?? '';
        else if (delta.type === 'input_json_delta') block.inputRaw += stringValue(delta.partial_json) ?? '';
        else if (delta.type !== 'signature_delta') block.value = toJsonValue(delta);
      } else if (eventType === 'message_delta') {
        recognized = true;
        stopReason = stringValue(asObject(event.delta).stop_reason) ?? stopReason;
      } else if (eventType === 'message_stop' || eventType === 'content_block_stop') {
        recognized = true;
      } else if (eventType === 'error') {
        recognized = true;
        error = parseProviderError(event.error ?? event);
      }
    } catch { /* Ignore incomplete or non-JSON SSE data lines. */ }
  }
  const normalizedUsage = normalizeUsage(usage);
  if (!recognized) return { usage: normalizedUsage, output: null };
  return {
    usage: normalizedUsage,
    output: {
      adapter_id: 'anthropic', id, model, role, stop_reason: stopReason,
      content: [...blocks.entries()].sort(([left], [right]) => left - right).map(([, block]) => finalizedBlock(block)),
      usage: normalizedUsage,
      ...(error ? { error } : {}),
    },
  };
}

const anthropic: ProviderAdapter = { id: 'anthropic', parseRequest, parseResponse };

export default anthropic;
