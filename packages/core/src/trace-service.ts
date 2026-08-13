import { appendFile, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Capture, CaptureIndexEntry, ConversationContentBlock, ConversationMessage, JsonValue, ModelOutputSnapshot, TraceInputRelation, TraceResult } from '@prompt-prism/contracts/server';
import type { ModelInputSnapshot } from '@prompt-prism/contracts/model';
import type { ProviderRequest, ProviderResponse } from './types.js';

export type TraceGroupSource = 'explicit' | 'inferred';
export type TraceMetadata = { trace_group_id: string; trace_group_source: TraceGroupSource; trace_group_index: number };
type Relation = { id: string; parent_capture_id: string | null };

function equal(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function primary(capture: Pick<CaptureIndexEntry, 'messages' | 'prompt_input'>): JsonValue[] {
  const input = capture.prompt_input;
  if (input?.primary_sequence) return input.primary_sequence;
  const section = input?.sections.find((item) => item.id === input.primary_section_id);
  return Array.isArray(section?.value) ? section.value : capture.messages;
}
function groupKey(capture: Pick<CaptureIndexEntry, 'adapter_id' | 'model' | 'token_hash' | 'upstream_host' | 'prompt_input'>): string {
  return JSON.stringify([capture.prompt_input?.adapter_id ?? capture.adapter_id ?? 'anthropic', capture.token_hash, capture.upstream_host ?? '', capture.model ?? '']);
}
function prefixScore(left: JsonValue[], right: JsonValue[]): number {
  let count = 0;
  while (count < left.length && count < right.length && equal(left[count], right[count])) count++;
  return count;
}
function entry(capture: Capture, file_ref = ''): CaptureIndexEntry {
  return { id: capture.id, timestamp: capture.timestamp, token_hash: capture.token_hash, model: capture.model, usage: capture.usage, response_status: capture.response?.status, upstream_host: capture.upstream_host, trace_id: capture.trace_id, timing: capture.timing, file_ref, messages: capture.messages, adapter_id: capture.adapter_id, prompt_input: capture.prompt_input };
}

export class TraceService {
  readonly path: string;
  readonly relations = new Map<string, string | null>();
  private captures: readonly CaptureIndexEntry[] = [];

  constructor(dataDir: string) { this.path = path.join(dataDir, 'trace.jsonl'); }
  async init(captures: readonly CaptureIndexEntry[]): Promise<void> {
    this.captures = captures;
    try {
      const content = await readFile(this.path, 'utf8');
      const ids = new Set(captures.map((item) => item.id));
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        const value = JSON.parse(line) as Relation;
        if (typeof value.id === 'string' && (typeof value.parent_capture_id === 'string' || value.parent_capture_id === null) && ids.has(value.id)) this.relations.set(value.id, value.parent_capture_id);
      }
    } catch (error: unknown) { if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error; }
    for (const capture of captures) if (!this.relations.has(capture.id)) this.relations.set(capture.id, capture.parent_capture_id ?? null);
  }
  getParentId = (id: string): string | null | undefined => this.relations.get(id);
  async prepare(capture: Capture, stored: CaptureIndexEntry): Promise<CaptureIndexEntry> {
    const current = { ...stored, ...entry(capture, stored.file_ref) };
    let parentId: string | null = null;
    if (!capture.trace_id && capture.prompt_input) {
      const candidates = this.captures.filter((candidate) => !candidate.trace_id && candidate.prompt_input && groupKey(candidate) === groupKey(current));
      const currentPrimary = primary(current);
      let best: CaptureIndexEntry | null = null;
      let score = 0;
      for (const candidate of candidates) {
        const next = prefixScore(primary(candidate), currentPrimary);
        if (next > 0 && (next > score || (next === score && candidate.timestamp > (best?.timestamp ?? '')))) { best = candidate; score = next; }
      }
      parentId = best?.id ?? null;
    }
    await appendFile(this.path, `${JSON.stringify({ id: capture.id, parent_capture_id: parentId })}\n`);
    this.relations.set(capture.id, parentId);
    return { ...stored, parent_capture_id: parentId ?? undefined };
  }
  published(captures: readonly CaptureIndexEntry[]): void { this.captures = captures; }
  remove(entry: CaptureIndexEntry): void { this.relations.delete(entry.id); this.captures = this.captures.filter((item) => item.id !== entry.id); }
  clear(): void { this.relations.clear(); this.captures = []; }
  metadata(captures: readonly CaptureIndexEntry[]): Map<string, TraceMetadata> {
    const byId = new Map(captures.map((item) => [item.id, item]));
    const root = (id: string) => { const seen = new Set<string>(); let current = id; while (!seen.has(current)) { seen.add(current); const parent = this.relations.get(current); if (!parent || !byId.has(parent)) return current; current = parent; } return current; };
    const groups = new Map<string, { id: string; source: TraceGroupSource; captures: CaptureIndexEntry[] }>();
    for (const capture of captures) {
      const source: TraceGroupSource = capture.trace_id ? 'explicit' : 'inferred'; const id = capture.trace_id ?? root(capture.id); const key = `${source}\0${id}`;
      const group = groups.get(key) ?? { id, source, captures: [] }; group.captures.push(capture); groups.set(key, group);
    }
    const result = new Map<string, TraceMetadata>();
    for (const group of groups.values()) {
      if (group.source === 'inferred' && group.captures.length < 2) continue;
      group.captures.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)).forEach((capture, index) => result.set(capture.id, { trace_group_id: group.id, trace_group_source: group.source, trace_group_index: index + 1 }));
    }
    return result;
  }

  async result(selectedId: string, captures: readonly CaptureIndexEntry[], readCapture: (id: string) => Promise<Capture | null>, parseRequest: (adapterId: string, body: string) => ProviderRequest, parseResponse: (adapterId: string, body: string, contentType?: string) => ProviderResponse): Promise<TraceResult | null> {
    const selected = captures.find((item) => item.id === selectedId);
    if (!selected || !(await readCapture(selectedId))) return null;
    const source = selected.trace_id ? 'explicit' as const : 'inferred' as const;
    const byId = new Map(captures.map((item) => [item.id, item]));
    let truncated = false;
    let entries: CaptureIndexEntry[];
    if (source === 'explicit') entries = captures.filter((item) => item.trace_id === selected.trace_id);
    else {
      entries = []; const seen = new Set<string>(); let current: CaptureIndexEntry | undefined = selected;
      while (current && !seen.has(current.id)) { entries.push(current); seen.add(current.id); const parent = this.getParentId(current.id); if (!parent) break; current = byId.get(parent); if (!current) truncated = true; }
      entries.reverse();
    }
    entries.sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
    const calls = [] as TraceResult['calls'];
    let previousConversation: ConversationMessage[] | null = null;
    let previousOutput: ModelOutputSnapshot | null = null;
    for (const entry of entries) {
      const capture = await readCapture(entry.id);
      const conversation = capture?.prompt_input?.conversation ?? this.readConversation(capture, parseRequest);
      const output = capture?.model_output ?? this.readOutput(capture, parseResponse);
      const next = this.inputDelta(conversation, previousConversation, previousOutput);
      calls.push({ capture_id: entry.id, timestamp: entry.timestamp, model: entry.model, response_status: entry.response_status, upstream_host: entry.upstream_host, input_relation: next.relation, input_delta: next.delta, output });
      previousConversation = conversation; previousOutput = output;
    }
    return { id: selected.trace_id ?? entries[0]?.id ?? selected.id, source, selected_capture_id: selected.id, truncated, calls };
  }

  private readConversation(capture: Capture | null, parseRequest: (adapterId: string, body: string) => ProviderRequest): ConversationMessage[] {
    if (!capture?.request?.body) return [];
    try { return parseRequest(capture.adapter_id ?? 'anthropic', capture.request.body).input.conversation ?? []; } catch { return []; }
  }
  private readOutput(capture: Capture | null, parseResponse: (adapterId: string, body: string, contentType?: string) => ProviderResponse): ModelOutputSnapshot | null {
    if (!capture?.response?.body) return null;
    const contentType = Object.entries(capture.response.headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
    try { return parseResponse(capture.adapter_id ?? 'anthropic', capture.response.body, Array.isArray(contentType) ? contentType[0] : contentType).output; } catch { return null; }
  }
  private inputDelta(current: ConversationMessage[], previous: ConversationMessage[] | null, previousOutput: ModelOutputSnapshot | null): { relation: TraceInputRelation; delta: ConversationMessage[] } {
    if (!previous) return { relation: 'root', delta: current };
    const content: ConversationContentBlock[] = (previousOutput?.content ?? []).filter((block) => block.type !== 'unknown' || block.provider_type !== 'openai_delta_fields');
    const assistant = content.length ? { role: previousOutput?.role ?? 'assistant', content } : null;
    const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
    const startsWith = (value: ConversationMessage[], prefix: ConversationMessage[]) => prefix.length <= value.length && prefix.every((item, index) => equal(item, value[index]));
    const expected = assistant ? [...previous, assistant] : previous;
    if (startsWith(current, expected)) return { relation: 'append', delta: current.slice(expected.length) };
    if (startsWith(current, previous)) { const suffix = current.slice(previous.length); return { relation: 'append', delta: assistant && equal(suffix[0], assistant) ? suffix.slice(1) : suffix }; }
    return { relation: 'rewritten', delta: current };
  }
}
