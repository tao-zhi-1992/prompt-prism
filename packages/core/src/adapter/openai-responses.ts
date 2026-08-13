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
  ToolCallOutputBlock,
  Usage,
} from '../types.js';
import type { ProviderAdapter } from './provider.js';

function object(value: unknown): JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
function text(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function json(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (Array.isArray(value)) return value.map(json);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, json(item)]));
  return String(value);
}
function usage(value: unknown): Usage {
  const source = object(value); const result: Usage = {};
  const input = number(source.input_tokens) ?? number(source.prompt_tokens);
  const output = number(source.output_tokens) ?? number(source.completion_tokens);
  const cached = number(object(source.input_tokens_details).cached_tokens) ?? number(object(source.prompt_tokens_details).cached_tokens);
  if (input !== undefined) result.input_tokens = Math.max(0, input - (cached ?? 0));
  if (output !== undefined) result.output_tokens = output;
  if (cached !== undefined) result.cache_read_input_tokens = cached;
  return result;
}
function error(value: unknown): ProviderError { const source = object(value); return { type: text(source.type) ?? text(source.code), message: text(source.message) ?? 'Unknown provider error', details: json(source) }; }
function identity(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(identity);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => key === 'cache_control' || item === undefined ? [] : [[key, identity(item)]]));
}
function toolArguments(value: unknown): Pick<ToolCallOutputBlock, 'input' | 'input_raw'> {
  if (value !== null && typeof value === 'object') return { input: json(value) };
  const raw = text(value) ?? '';
  try { return { input: json(JSON.parse(raw)) }; } catch { return { input: null, input_raw: raw }; }
}
function content(value: unknown): ConversationContentBlock[] {
  if (typeof value === 'string') return [{ type: 'text', text: value }];
  if (!Array.isArray(value)) return value === null || value === undefined ? [] : [{ type: 'unknown', provider_type: 'responses_input', value: json(value) }];
  return value.flatMap((item): ConversationContentBlock[] => {
    const block = object(item); const type = text(block.type) ?? 'unknown';
    if (type === 'input_text' || type === 'output_text' || type === 'text') return [{ type: 'text', text: text(block.text) ?? '' }];
    if (type === 'input_image' || type === 'input_file') return [{ type: 'unknown', provider_type: type, value: json(item) }];
    return [{ type: 'unknown', provider_type: type, value: json(item) }];
  });
}
function inputItems(value: unknown): ConversationMessage[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [{ type: 'message', role: 'user', content: value }] : [];
  return items.flatMap((item): ConversationMessage[] => {
    const input = object(item); const type = text(input.type) ?? 'message'; const role = text(input.role) ?? (type === 'function_call_output' ? 'tool' : 'user');
    if (type === 'function_call_output') return [{ role, content: [{ type: 'tool_result', tool_call_id: text(input.call_id), content: input.output === undefined ? '' : json(input.output), is_error: null }] }];
    if (type === 'function_call') return [{ role: 'assistant', content: [{ type: 'tool_call', id: text(input.call_id) ?? text(input.id), name: text(input.name) ?? 'Unknown tool', ...toolArguments(input.arguments) }] }];
    return [{ role, content: content(input.content) }];
  });
}
function outputItem(value: unknown): ModelOutputBlock[] {
  const item = object(value); const type = text(item.type) ?? 'unknown';
  if (type === 'message') return content(item.content).map((block): ModelOutputBlock => {
    if (block.type === 'text' || block.type === 'reasoning' || block.type === 'tool_call') return block;
    if (block.type === 'unknown') return { type: 'unknown', provider_type: block.provider_type, value: block.value, ...(block.visibility ? { visibility: block.visibility } : {}) };
    return { type: 'unknown', provider_type: `conversation_${block.type}`, value: json(block) };
  });
  if (type === 'function_call' || type === 'custom_tool_call') return [{ type: 'tool_call', id: text(item.call_id) ?? text(item.id), name: text(item.name) ?? 'Unknown tool', ...toolArguments(item.arguments ?? item.input) }];
  if (type === 'reasoning') {
    const summary = Array.isArray(item.summary) ? item.summary.map(object).map((part) => text(part.text) ?? '').join('') : text(item.text) ?? '';
    return summary ? [{ type: 'reasoning', text: summary }] : [{ type: 'unknown', provider_type: type, value: json(item) }];
  }
  return [{ type: 'unknown', provider_type: type, value: json(item) }];
}

export function parseRequest(body: Buffer | string): ProviderRequest {
  const parsed = object(JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '')));
  const conversation = inputItems(parsed.input);
  const instructions = parsed.instructions ?? null;
  const tools = parsed.tools ?? [];
  const options = Object.fromEntries(Object.entries(parsed).filter(([key]) => !['input', 'instructions', 'tools'].includes(key))) as JsonObject;
  const messages: Message[] = conversation.map((message) => ({ role: message.role, content: json(message.content) }));
  const sections: ModelInputSection[] = [
    { id: 'input', label: 'Input', order: 10, value: parsed.input === undefined ? [] : json(parsed.input), compare_as: 'sequence', default_collapsed: false },
    { id: 'instructions', label: 'Instructions', order: 20, value: json(instructions), compare_as: 'json', default_collapsed: true },
    { id: 'tools', label: 'Tools', order: 30, value: json(tools), compare_as: 'json', default_collapsed: true },
    { id: 'options', label: 'Request options', order: 40, value: json(options), compare_as: 'json', default_collapsed: true },
  ];
  return { model: text(parsed.model), messages, input: { adapter_id: 'openai-responses', primary_section_id: 'input', primary_sequence: (Array.isArray(parsed.input) ? parsed.input : [parsed.input]).filter((value) => value !== undefined).map((value) => identity(json(value))), sections, conversation } };
}

function response(value: JsonObject): ProviderResponse {
  const normalizedUsage = usage(value.usage);
  if (value.error !== undefined || value.type === 'error') return { usage: normalizedUsage, output: { adapter_id: 'openai-responses', id: text(value.id), model: text(value.model), role: null, stop_reason: null, content: [], usage: normalizedUsage, error: error(value.error ?? value) } };
  if (value.object !== 'response' && !Array.isArray(value.output)) return { usage: normalizedUsage, output: null };
  return { usage: normalizedUsage, output: { adapter_id: 'openai-responses', id: text(value.id), model: text(value.model), role: 'assistant', stop_reason: text(value.status) ?? text(value.incomplete_details), content: (Array.isArray(value.output) ? value.output : []).flatMap(outputItem), usage: normalizedUsage } };
}

export function parseResponse(body: Buffer | string, contentType = ''): ProviderResponse {
  const source = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  if (!/text\/event-stream/i.test(contentType)) { try { return response(object(JSON.parse(source))); } catch { return { usage: {}, output: null }; } }
  const blocks = new Map<number, ModelOutputBlock[]>(); let id: string | null = null; let model: string | null = null; let state: string | null = null; let latestUsage: Usage = {}; let seen = false; let providerError: ProviderError | undefined;
  for (const line of source.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue; const raw = line.slice(5).trim(); if (!raw || raw === '[DONE]') continue;
    try {
      const event = object(JSON.parse(raw)); const type = text(event.type) ?? ''; const responseValue = object(event.response); const index = number(event.output_index) ?? 0;
      if (responseValue.id) { id = text(responseValue.id) ?? id; model = text(responseValue.model) ?? model; latestUsage = usage(responseValue.usage); state = text(responseValue.status) ?? state; }
      if (event.error !== undefined || type === 'error') { seen = true; providerError = error(event.error ?? event); continue; }
      if (type.startsWith('response.')) seen = true;
      if (type === 'response.output_item.done' || type === 'response.output_item.added') blocks.set(index, outputItem(event.item));
      else if (type === 'response.output_text.delta' || type === 'response.output_text.done') { const prior = blocks.get(index) ?? []; const block = prior.find((item) => item.type === 'text'); const value = type.endsWith('.done') ? text(event.text) ?? '' : text(event.delta) ?? ''; if (block?.type === 'text') block.text += value; else prior.push({ type: 'text', text: value }); blocks.set(index, prior); }
      else if (type === 'response.reasoning_text.delta' || type === 'response.reasoning_summary_text.delta') { const prior = blocks.get(index) ?? []; const block = prior.find((item) => item.type === 'reasoning'); const value = text(event.delta) ?? ''; if (block?.type === 'reasoning') block.text += value; else prior.push({ type: 'reasoning', text: value }); blocks.set(index, prior); }
      else if (type === 'response.function_call_arguments.done' || type === 'response.custom_tool_call_input.done' || type === 'response.mcp_call_arguments.done') blocks.set(index, [{ type: 'tool_call', id: text(event.call_id) ?? text(event.item_id), name: text(event.name) ?? 'Unknown tool', ...toolArguments(event.arguments ?? event.input) }]);
      else if (type === 'response.completed' || type === 'response.incomplete') { id = text(responseValue.id) ?? id; model = text(responseValue.model) ?? model; latestUsage = usage(responseValue.usage); state = text(responseValue.status) ?? state; }
    } catch { /* Preserve valid events around malformed stream fragments. */ }
  }
  if (!seen) return { usage: {}, output: null };
  const content = [...blocks.entries()].sort(([a], [b]) => a - b).flatMap(([, value]) => value);
  return { usage: latestUsage, output: { adapter_id: 'openai-responses', id, model, role: 'assistant', stop_reason: state, content, usage: latestUsage, ...(providerError ? { error: providerError } : {}) } };
}

const responses: ProviderAdapter = {
  id: 'openai-responses',
  detection: {
    endpointPath: '/v1/responses',
    detectPath: (pathname) => /(?:^|\/)responses\/?$/i.test(pathname),
    detectHeaders: () => false,
    detectRequest: (body) => { try { const value = object(JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : body)); return 'input' in value && !('messages' in value); } catch { return false; } },
    detectResponse: (body) => { const value = Buffer.isBuffer(body) ? body.toString('utf8') : body; return /"object"\s*:\s*"response"|"type"\s*:\s*"response\./.test(value); },
    // An OpenAI Base URL alone is ambiguous: Chat Completions and Responses share it.
    // Path/body/response evidence selects Responses for an individual capture.
    detectBaseUrl: () => false,
  },
  parseRequest,
  parseResponse,
};

export default responses;
