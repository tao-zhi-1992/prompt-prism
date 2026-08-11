import type {
  Capture,
  CaptureIndexEntry,
  ConversationContentBlock,
  ConversationMessage,
  ModelOutputSnapshot,
  PromptPrismServerPlugin,
  RawHeaders,
  ServerPluginContext,
} from '../../contracts/server.js';
import { tracePluginMeta } from '../index.js';

export type TraceInputRelation = 'root' | 'append' | 'rewritten';

export interface TraceCall {
  capture_id: string;
  timestamp: string;
  model: string | null;
  response_status?: number | null;
  upstream_host?: string;
  input_relation: TraceInputRelation;
  input_delta: ConversationMessage[];
  output: ModelOutputSnapshot | null;
}

export interface TraceResult {
  id: string;
  source: 'explicit' | 'inferred';
  selected_capture_id: string;
  truncated: boolean;
  calls: TraceCall[];
}

export type ParentLookup = (id: string) => string | null | undefined;

function header(headers: RawHeaders | undefined, name: string): string | undefined {
  const found = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
  return Array.isArray(found) ? found[0] : found;
}

export function readCaptureConversation(capture: Capture, context: ServerPluginContext): ConversationMessage[] {
  if (capture.prompt_input?.conversation) return capture.prompt_input.conversation;
  if (!capture.request?.body) return [];
  try { return context.parseProviderRequest(capture.adapter_id ?? 'anthropic', capture.request.body).input.conversation ?? []; }
  catch { return []; }
}

export function readCaptureOutput(capture: Capture, context: ServerPluginContext): ModelOutputSnapshot | null {
  if (capture.model_output) return capture.model_output;
  if (!capture.response?.body) return null;
  try {
    return context.parseProviderResponse(
      capture.adapter_id ?? 'anthropic',
      capture.response.body,
      header(capture.response.headers, 'content-type'),
    ).output;
  } catch { return null; }
}

function outputMessage(output: ModelOutputSnapshot | null): ConversationMessage | null {
  if (!output || output.error || !output.content.length) return null;
  const content: ConversationContentBlock[] = output.content.filter((block) => block.type !== 'unknown' || block.provider_type !== 'openai_delta_fields').map((block) => {
    if (block.type === 'text') return { type: 'text', text: block.text };
    if (block.type === 'reasoning') return { type: 'reasoning', text: block.text };
    if (block.type === 'tool_call') return {
      type: 'tool_call', id: block.id, name: block.name, input: block.input,
      ...(block.input_raw !== undefined ? { input_raw: block.input_raw } : {}),
    };
    return { type: 'unknown', provider_type: block.provider_type, value: block.value };
  });
  return content.length ? { role: output.role ?? 'assistant', content } : null;
}

function equal(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

function startsWith(current: ConversationMessage[], prefix: ConversationMessage[]): boolean {
  return prefix.length <= current.length && prefix.every((message, index) => equal(message, current[index]));
}

function inputDelta(
  current: ConversationMessage[],
  previous: ConversationMessage[] | null,
  previousOutput: ModelOutputSnapshot | null,
): { relation: TraceInputRelation; delta: ConversationMessage[] } {
  if (!previous) return { relation: 'root', delta: current };
  const assistant = outputMessage(previousOutput);
  const expected = assistant ? [...previous, assistant] : previous;
  if (startsWith(current, expected)) return { relation: 'append', delta: current.slice(expected.length) };
  if (startsWith(current, previous)) {
    const suffix = current.slice(previous.length);
    return { relation: 'append', delta: assistant && equal(suffix[0], assistant) ? suffix.slice(1) : suffix };
  }
  return { relation: 'rewritten', delta: current };
}

export function explicitTraceEntries(selected: CaptureIndexEntry, captures: readonly CaptureIndexEntry[]): CaptureIndexEntry[] {
  return captures.filter((entry) => entry.trace_id === selected.trace_id);
}

export function inferredTraceEntries(selected: CaptureIndexEntry, captures: readonly CaptureIndexEntry[], getParentId: ParentLookup) {
  const byId = new Map(captures.map((entry) => [entry.id, entry]));
  const chain: CaptureIndexEntry[] = [];
  const seen = new Set<string>();
  let current: CaptureIndexEntry | undefined = selected;
  let truncated = false;
  while (current && !seen.has(current.id)) {
    chain.push(current);
    seen.add(current.id);
    const parentId = getParentId(current.id);
    if (!parentId) break;
    current = byId.get(parentId);
    if (!current) truncated = true;
  }
  return { entries: chain.reverse(), truncated };
}

export async function buildTraceResult(
  selectedId: string,
  context: ServerPluginContext,
  getParentId: ParentLookup,
): Promise<TraceResult | null> {
  const selected = context.captures.find((entry) => entry.id === selectedId);
  if (!selected || !(await context.readCapture(selected.id))) return null;

  const source = selected.trace_id ? 'explicit' as const : 'inferred' as const;
  const inferred = source === 'inferred' ? inferredTraceEntries(selected, context.captures, getParentId) : null;
  const entries = (source === 'explicit' ? explicitTraceEntries(selected, context.captures) : inferred!.entries)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
  const calls: TraceCall[] = [];
  let previousConversation: ConversationMessage[] | null = null;
  let previousOutput: ModelOutputSnapshot | null = null;

  for (const entry of entries) {
    const capture = await context.readCapture(entry.id);
    const conversation = capture ? readCaptureConversation(capture, context) : entry.prompt_input?.conversation ?? [];
    const output = capture ? readCaptureOutput(capture, context) : null;
    const next = inputDelta(conversation, previousConversation, previousOutput);
    calls.push({
      capture_id: entry.id,
      timestamp: entry.timestamp,
      model: entry.model,
      response_status: entry.response_status,
      upstream_host: entry.upstream_host,
      input_relation: next.relation,
      input_delta: next.delta,
      output,
    });
    previousConversation = conversation;
    previousOutput = output;
  }

  return {
    id: selected.trace_id ?? entries[0]?.id ?? selected.id,
    source,
    selected_capture_id: selected.id,
    truncated: inferred?.truncated ?? false,
    calls,
  };
}

export function createTraceServerPlugin({ getParentId }: { getParentId: ParentLookup }): PromptPrismServerPlugin {
  return {
    id: tracePluginMeta.id,
    async handleApi(request, response, subpath, context) {
      if (request.method !== 'GET') {
        context.json(response, 405, { error: 'Method not allowed' });
        return true;
      }
      const result = await buildTraceResult(decodeURIComponent(subpath), context, getParentId);
      if (!result) {
        context.json(response, 404, { error: 'Capture not found' });
        return true;
      }
      context.json(response, 200, result);
      return true;
    },
  };
}
