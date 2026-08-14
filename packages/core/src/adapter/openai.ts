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

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function asMessages(value: unknown): Message[] {
  return Array.isArray(value) ? value.filter((item): item is Message => item !== null && typeof item === 'object' && !Array.isArray(item)) : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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

function inputIdentity(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(inputIdentity);
  if (value === null || typeof value !== 'object') return value;
  const normalized: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'cache_control' && child !== undefined) normalized[key] = inputIdentity(child);
  }
  return normalized;
}

function normalizeUsage(value: unknown): Usage {
  const usage = asObject(value);
  const promptTokens = finiteNumber(usage.prompt_tokens);
  const inputAlias = finiteNumber(usage.input_tokens);
  const completionTokens = finiteNumber(usage.completion_tokens) ?? finiteNumber(usage.output_tokens);
  const details = asObject(usage.prompt_tokens_details);
  const cachedTokens = finiteNumber(details.cached_tokens) ?? finiteNumber(usage.cache_read_input_tokens);
  const normalized: Usage = {};
  if (promptTokens !== undefined) normalized.input_tokens = Math.max(0, promptTokens - (cachedTokens ?? 0));
  else if (inputAlias !== undefined) normalized.input_tokens = inputAlias;
  if (completionTokens !== undefined) normalized.output_tokens = completionTokens;
  if (cachedTokens !== undefined) normalized.cache_read_input_tokens = cachedTokens;
  return normalized;
}

function parseProviderError(value: unknown): ProviderError {
  const error = asObject(value);
  return {
    type: stringValue(error.type) ?? stringValue(error.code),
    message: stringValue(error.message) ?? 'Unknown provider error',
    details: toJsonValue(error),
  };
}

function parsedArguments(value: unknown): Pick<ToolCallOutputBlock, 'input' | 'input_raw'> {
  if (value !== null && typeof value === 'object') return { input: toJsonValue(value) };
  const raw = typeof value === 'string' ? value : '';
  try { return { input: toJsonValue(JSON.parse(raw)) }; }
  catch { return { input: null, input_raw: raw }; }
}

function contentBlocks(value: unknown): ConversationContentBlock[] {
  if (typeof value === 'string') return [{ type: 'text', text: value }];
  if (!Array.isArray(value)) return value === null || value === undefined ? [] : [{ type: 'unknown', provider_type: 'content', value: toJsonValue(value) }];
  return value.map((item): ConversationContentBlock => {
    const block = asObject(item);
    const providerType = stringValue(block.type) ?? 'unknown';
    if ((providerType === 'text' || providerType === 'input_text' || providerType === 'output_text') && typeof block.text === 'string') {
      return { type: 'text', text: block.text };
    }
    return { type: 'unknown', provider_type: providerType, value: toJsonValue(item) };
  });
}

function toolCallBlock(value: unknown): ConversationContentBlock {
  const call = asObject(value);
  const fn = asObject(call.function);
  return {
    type: 'tool_call',
    id: stringValue(call.id),
    name: stringValue(fn.name) ?? stringValue(call.name) ?? 'Unknown tool',
    ...parsedArguments(fn.arguments ?? call.arguments),
  };
}

function normalizeConversation(messages: Message[]): ConversationMessage[] {
  return messages.map((message) => {
    const role = typeof message.role === 'string' ? message.role : 'unknown';
    if (role === 'tool' || role === 'function') {
      return {
        role,
        content: [{
          type: 'tool_result',
          tool_call_id: stringValue(message.tool_call_id),
          content: message.content === undefined ? '' : toJsonValue(message.content),
          is_error: typeof message.is_error === 'boolean' ? message.is_error : null,
        }],
      };
    }
    const content: ConversationContentBlock[] = [];
    const reasoning = stringValue(message.reasoning_content);
    if (reasoning !== null) content.push({ type: 'reasoning', text: reasoning });
    content.push(...contentBlocks(message.content));
    if (Array.isArray(message.tool_calls)) content.push(...message.tool_calls.map(toolCallBlock));
    else if (message.function_call !== undefined) content.push(toolCallBlock({ function: message.function_call }));
    return { role, content };
  });
}

function outputToolCall(value: unknown): ToolCallOutputBlock {
  const call = asObject(value);
  const fn = asObject(call.function);
  return {
    type: 'tool_call',
    id: stringValue(call.id),
    name: stringValue(fn.name) ?? stringValue(call.name) ?? 'Unknown tool',
    ...parsedArguments(fn.arguments ?? call.arguments),
  };
}

function outputBlocks(messageValue: unknown): ModelOutputBlock[] {
  const message = asObject(messageValue);
  const blocks: ModelOutputBlock[] = [];
  const reasoning = stringValue(message.reasoning_content);
  if (reasoning !== null) blocks.push({ type: 'reasoning', text: reasoning });
  for (const block of contentBlocks(message.content)) {
    if (block.type === 'text') blocks.push(block);
    else if (block.type === 'unknown') blocks.push(block);
    else blocks.push({ type: 'unknown', provider_type: `content_${block.type}`, value: toJsonValue(block) });
  }
  if (message.refusal !== undefined && message.refusal !== null) blocks.push({ type: 'unknown', provider_type: 'refusal', value: toJsonValue(message.refusal) });
  if (Array.isArray(message.tool_calls)) blocks.push(...message.tool_calls.map(outputToolCall));
  else if (message.function_call !== undefined) blocks.push(outputToolCall({ function: message.function_call }));
  const known = new Set(['role', 'content', 'reasoning_content', 'refusal', 'tool_calls', 'function_call']);
  const extra = Object.fromEntries(Object.entries(message).filter(([key, value]) => !known.has(key) && value !== undefined));
  if (Object.keys(extra).length > 0) blocks.push({ type: 'unknown', provider_type: 'openai_message_fields', value: toJsonValue(extra) });
  return blocks;
}

function choiceIndex(value: unknown, fallback: number): number {
  const index = finiteNumber(asObject(value).index);
  return index === undefined ? fallback : index;
}

function outputFromCompletion(completion: JsonObject, usage: Usage): ModelOutputSnapshot | null {
  const choices = Array.isArray(completion.choices)
    ? completion.choices.map((choice, position) => ({ choice: asObject(choice), index: choiceIndex(choice, position) })).sort((left, right) => left.index - right.index)
    : [];
  const primary = choices[0];
  if (!primary) return null;
  const message = asObject(primary.choice.message);
  const content = outputBlocks(message);
  for (const additional of choices.slice(1)) {
    content.push({ type: 'unknown', provider_type: 'openai_choice', value: toJsonValue(additional.choice) });
  }
  return {
    adapter_id: 'openai-chat-completions',
    id: stringValue(completion.id),
    model: stringValue(completion.model),
    role: stringValue(message.role),
    stop_reason: stringValue(primary.choice.finish_reason),
    content,
    usage,
  };
}

type MutableToolCall = { id: string | null; name: string; arguments: string; type: string | null };
type MutableChoice = {
  index: number;
  role: string | null;
  finishReason: string | null;
  text: string;
  reasoning: string;
  refusals: JsonValue[];
  tools: Map<number, MutableToolCall>;
  extras: JsonObject[];
};

function mutableChoice(index: number): MutableChoice {
  return { index, role: null, finishReason: null, text: '', reasoning: '', refusals: [], tools: new Map(), extras: [] };
}

function appendToolDelta(choice: MutableChoice, value: unknown, fallbackIndex: number): void {
  const delta = asObject(value);
  const index = finiteNumber(delta.index) ?? fallbackIndex;
  const fn = asObject(delta.function);
  let tool = choice.tools.get(index);
  if (!tool) {
    tool = { id: null, name: '', arguments: '', type: null };
    choice.tools.set(index, tool);
  }
  tool.id = stringValue(delta.id) ?? tool.id;
  tool.type = stringValue(delta.type) ?? tool.type;
  tool.name += stringValue(fn.name) ?? stringValue(delta.name) ?? '';
  tool.arguments += stringValue(fn.arguments) ?? stringValue(delta.arguments) ?? '';
}

function streamChoiceValue(choice: MutableChoice): JsonValue {
  return {
    index: choice.index,
    role: choice.role,
    finish_reason: choice.finishReason,
    content: choice.text,
    reasoning_content: choice.reasoning,
    tool_calls: [...choice.tools.entries()].sort(([left], [right]) => left - right).map(([index, tool]) => ({
      index, id: tool.id, type: tool.type, function: { name: tool.name, arguments: tool.arguments },
    })),
    ...(choice.refusals.length > 0 ? { refusal: choice.refusals } : {}),
    ...(choice.extras.length > 0 ? { extra_deltas: choice.extras } : {}),
  };
}

function finalizedChoiceBlocks(choice: MutableChoice): ModelOutputBlock[] {
  const content: ModelOutputBlock[] = [];
  if (choice.reasoning) content.push({ type: 'reasoning', text: choice.reasoning });
  if (choice.text) content.push({ type: 'text', text: choice.text });
  for (const refusal of choice.refusals) content.push({ type: 'unknown', provider_type: 'refusal', value: refusal });
  for (const [, tool] of [...choice.tools.entries()].sort(([left], [right]) => left - right)) {
    content.push({ type: 'tool_call', id: tool.id, name: tool.name || 'Unknown tool', ...parsedArguments(tool.arguments) });
  }
  return content;
}

export function parseRequest(body: Buffer | string): ProviderRequest {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  const parsed = asObject(JSON.parse(text));
  const allMessages = asMessages(parsed.messages);
  const system = allMessages.filter((message) => message.role === 'system' || message.role === 'developer');
  const messages = allMessages.filter((message) => message.role !== 'system' && message.role !== 'developer');
  const options = Object.fromEntries(Object.entries(parsed).filter(([key]) => !['messages', 'tools'].includes(key))) as JsonObject;
  const sections: ModelInputSection[] = [
    { id: 'messages', label: 'Messages', order: 10, value: messages, compare_as: 'sequence', default_collapsed: false },
    { id: 'system', label: 'System', order: 20, value: system, compare_as: 'json', default_collapsed: true },
    { id: 'tools', label: 'Tools', order: 30, value: (parsed.tools ?? []) as JsonValue, compare_as: 'json', default_collapsed: true },
    { id: 'options', label: 'Request options', order: 40, value: options, compare_as: 'json', default_collapsed: true },
  ];
  return {
    model: stringValue(parsed.model),
    messages: allMessages,
    input: {
      adapter_id: 'openai-chat-completions',
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
      if (parsed.error !== undefined || parsed.object === 'error') {
        return {
          usage,
          output: {
            adapter_id: 'openai-chat-completions', id: null, model: null, role: null, stop_reason: null,
            content: [], usage, error: parseProviderError(parsed.error ?? parsed),
          },
        };
      }
      return { usage, output: outputFromCompletion(parsed, usage) };
    } catch { return { usage: {}, output: null }; }
  }

  let id: string | null = null;
  let model: string | null = null;
  let usageValue: JsonObject = {};
  let error: ProviderError | undefined;
  let recognized = false;
  const choices = new Map<number, MutableChoice>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const chunk = asObject(JSON.parse(data));
      if (chunk.error !== undefined || chunk.object === 'error') {
        recognized = true;
        error = parseProviderError(chunk.error ?? chunk);
        continue;
      }
      id = stringValue(chunk.id) ?? id;
      model = stringValue(chunk.model) ?? model;
      if (chunk.usage !== undefined) usageValue = { ...usageValue, ...asObject(chunk.usage) };
      if (!Array.isArray(chunk.choices)) continue;
      for (let position = 0; position < chunk.choices.length; position++) {
        const rawChoice = asObject(chunk.choices[position]);
        const index = finiteNumber(rawChoice.index) ?? position;
        let choice = choices.get(index);
        if (!choice) {
          choice = mutableChoice(index);
          choices.set(index, choice);
        }
        recognized = true;
        choice.finishReason = stringValue(rawChoice.finish_reason) ?? choice.finishReason;
        const delta = asObject(rawChoice.delta);
        choice.role = stringValue(delta.role) ?? choice.role;
        const content = delta.content;
        if (typeof content === 'string') choice.text += content;
        else if (content !== undefined && content !== null) choice.extras.push({ content: toJsonValue(content) });
        choice.reasoning += stringValue(delta.reasoning_content) ?? '';
        if (delta.refusal !== undefined && delta.refusal !== null) choice.refusals.push(toJsonValue(delta.refusal));
        if (Array.isArray(delta.tool_calls)) delta.tool_calls.forEach((tool, toolIndex) => appendToolDelta(choice!, tool, toolIndex));
        else if (delta.function_call !== undefined) appendToolDelta(choice, { index: 0, function: delta.function_call }, 0);
        const known = new Set(['role', 'content', 'reasoning_content', 'refusal', 'tool_calls', 'function_call']);
        const extra = Object.fromEntries(Object.entries(delta).filter(([key, value]) => !known.has(key) && value !== undefined)) as JsonObject;
        if (Object.keys(extra).length > 0) choice.extras.push(extra);
      }
    } catch { /* Ignore malformed or incomplete SSE data lines. */ }
  }
  const usage = normalizeUsage(usageValue);
  if (!recognized) return { usage, output: null };
  const ordered = [...choices.values()].sort((left, right) => left.index - right.index);
  const primary = ordered[0];
  const content = primary ? finalizedChoiceBlocks(primary) : [];
  for (const additional of ordered.slice(1)) content.push({ type: 'unknown', provider_type: 'openai_choice', value: streamChoiceValue(additional) });
  return {
    usage,
    output: {
      adapter_id: 'openai-chat-completions', id, model, role: primary?.role ?? null, stop_reason: primary?.finishReason ?? null,
      content, usage, ...(error ? { error } : {}),
    },
  };
}

const openai: ProviderAdapter = {
  id: 'openai-chat-completions',
  detection: {
    endpointPath: '/v1/chat/completions',
    detectPath: (pathname) => /(?:^|\/)chat\/completions\/?$/i.test(pathname),
    detectHeaders: () => false,
    detectRequest: (body) => {
      try {
        const value = asObject(JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : body));
        const messages = Array.isArray(value.messages) ? value.messages.map(asObject) : [];
        const tools = Array.isArray(value.tools) ? value.tools.map(asObject) : [];
        return tools.some((tool) => tool.type === 'function' && asObject(tool.function)) || messages.some((message) => message.role === 'developer' || message.role === 'tool' || Array.isArray(message.tool_calls));
      } catch { return false; }
    },
    detectResponse: (body) => {
      const text = Buffer.isBuffer(body) ? body.toString('utf8') : body;
      if (/"object"\s*:\s*"chat\.completion(?:\.chunk)?"/.test(text)) return true;
      try { const value = asObject(JSON.parse(text)); return Array.isArray(value.choices) || value.object === 'chat.completion'; } catch { return false; }
    },
    detectBaseUrl: (url) => ['api.openai.com', 'api.deepseek.com', 'api.groq.com', 'api.together.xyz'].includes(url.hostname.toLowerCase()) || /(?:^|\/)openai(?:\/|$)/.test(url.pathname.toLowerCase()),
  },
  parseRequest,
  parseResponse,
};

export default openai;
