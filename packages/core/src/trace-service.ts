import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Capture, CaptureIndexEntry, ConversationContentBlock, ConversationMessage, JsonValue, ModelOutputSnapshot, TraceInputRelation, TraceResult } from '@prompt-prism/contracts/server';
import type { ProviderRequest, ProviderResponse } from './types.js';

export type TraceGroupSource = 'explicit' | 'inferred';
export type TraceMetadata = { trace_group_id: string; trace_group_source: TraceGroupSource; trace_group_index: number };
type RelationReason = 'explicit_trace_id' | 'input_prefix' | 'input_with_previous_output';
type Relation = { id: string; parent_capture_id: string | null; source?: 'explicit' | 'inferred'; reason?: RelationReason; version?: 1 };
type Parsed = { conversation: ConversationMessage[]; output: ModelOutputSnapshot | null };
const MAX_INFERENCE_AGE_MS = 30 * 60 * 1000;

function equal(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function primary(capture: Pick<CaptureIndexEntry, 'messages' | 'prompt_input'>): JsonValue[] {
  const input = capture.prompt_input;
  if (input?.primary_sequence) return input.primary_sequence;
  const section = input?.sections.find((item) => item.id === input.primary_section_id);
  return Array.isArray(section?.value) ? section.value : capture.messages;
}
function groupKey(capture: Pick<CaptureIndexEntry, 'adapter_id' | 'model' | 'token_hash' | 'upstream_host' | 'prompt_input'>): string | null {
  const adapter = capture.prompt_input?.adapter_id ?? capture.adapter_id;
  return adapter ? JSON.stringify([adapter, capture.token_hash, capture.upstream_host ?? '', capture.model ?? '']) : null;
}
function startsWith(value: JsonValue[], prefix: JsonValue[]): boolean { return prefix.length > 0 && prefix.length <= value.length && prefix.every((item, index) => equal(item, value[index])); }
function entry(capture: Capture, file_ref = ''): CaptureIndexEntry {
  return { id: capture.id, timestamp: capture.timestamp, token_hash: capture.token_hash, model: capture.model, usage: capture.usage, response_status: capture.response?.status, upstream_host: capture.upstream_host, trace_id: capture.trace_id, timing: capture.timing, file_ref, messages: capture.messages, adapter_id: capture.adapter_id, prompt_input: capture.prompt_input };
}
function relationEntry(relation: Relation): Pick<CaptureIndexEntry, 'parent_capture_id' | 'trace_relation_source' | 'trace_relation_reason' | 'trace_relation_version'> {
  return { ...(relation.parent_capture_id ? { parent_capture_id: relation.parent_capture_id } : {}), ...(relation.source ? { trace_relation_source: relation.source } : {}), ...(relation.reason ? { trace_relation_reason: relation.reason } : {}), ...(relation.version ? { trace_relation_version: relation.version } : {}) };
}

export class TraceService {
  readonly path: string;
  readonly relations = new Map<string, Relation>();
  private captures: readonly CaptureIndexEntry[] = [];
  constructor(dataDir: string) { this.path = path.join(dataDir, 'trace.jsonl'); }
  async init(captures: readonly CaptureIndexEntry[]): Promise<void> {
    this.captures = captures;
    try {
      const content = await readFile(this.path, 'utf8'); const ids = new Set(captures.map((item) => item.id));
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        const value = JSON.parse(line) as Relation;
        if (typeof value.id === 'string' && (typeof value.parent_capture_id === 'string' || value.parent_capture_id === null) && ids.has(value.id)) this.relations.set(value.id, value);
      }
    } catch (error: unknown) { if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error; }
    for (const capture of captures) if (!this.relations.has(capture.id)) this.relations.set(capture.id, { id: capture.id, parent_capture_id: capture.parent_capture_id ?? null, source: capture.trace_relation_source, reason: capture.trace_relation_reason, version: capture.trace_relation_version });
  }
  getParentId = (id: string): string | null | undefined => this.relations.get(id)?.parent_capture_id;
  async prepare(capture: Capture, stored: CaptureIndexEntry, readCapture: (id: string) => Promise<Capture | null>, parseRequest: (adapterId: string, body: string) => ProviderRequest, parseResponse: (adapterId: string, body: string, contentType?: string) => ProviderResponse): Promise<CaptureIndexEntry> {
    const current = { ...stored, ...entry(capture, stored.file_ref) };
    const relation = await this.inferRelation(capture, current, readCapture, parseRequest, parseResponse);
    await appendFile(this.path, `${JSON.stringify(relation)}\n`);
    this.relations.set(capture.id, relation);
    return { ...stored, ...relationEntry(relation) };
  }
  private async inferRelation(capture: Capture, current: CaptureIndexEntry, readCapture: (id: string) => Promise<Capture | null>, parseRequest: (adapterId: string, body: string) => ProviderRequest, parseResponse: (adapterId: string, body: string, contentType?: string) => ProviderResponse): Promise<Relation> {
    if (capture.trace_id) return { id: capture.id, parent_capture_id: null, source: 'explicit', reason: 'explicit_trace_id', version: 1 };
    if (!capture.prompt_input) return { id: capture.id, parent_capture_id: null, version: 1 };
    const currentKey = groupKey(current); const currentPrimary = primary(current); const currentTime = Date.parse(current.timestamp);
    if (!currentKey || !Number.isFinite(currentTime) || !currentPrimary.length) return { id: capture.id, parent_capture_id: null, version: 1 };
    const matches: Array<{ candidate: CaptureIndexEntry; reason: RelationReason }> = [];
    for (const candidate of this.captures) {
      if (candidate.trace_id || !candidate.prompt_input || groupKey(candidate) !== currentKey) continue;
      const age = currentTime - Date.parse(candidate.timestamp);
      if (!Number.isFinite(age) || age < 0 || age > MAX_INFERENCE_AGE_MS) continue;
      const candidatePrimary = primary(candidate);
      if (startsWith(currentPrimary, candidatePrimary)) { matches.push({ candidate, reason: 'input_prefix' }); continue; }
      const prior = await readCapture(candidate.id); const parsed = this.parsed(prior, parseRequest, parseResponse);
      const output = parsed.output?.content.filter((block) => block.type !== 'unknown' || block.visibility !== 'internal') ?? [];
      const assistant = output.length ? { role: parsed.output?.role ?? 'assistant', content: output } : null;
      const candidateConversation = candidate.prompt_input.conversation ?? parsed.conversation;
      const currentConversation = capture.prompt_input.conversation ?? [];
      if (assistant && this.conversationStartsWith(currentConversation, [...candidateConversation, assistant])) matches.push({ candidate, reason: 'input_with_previous_output' });
    }
    if (matches.length !== 1) return { id: capture.id, parent_capture_id: null, version: 1 };
    const match = matches[0]!;
    return { id: capture.id, parent_capture_id: match.candidate.id, source: 'inferred', reason: match.reason, version: 1 };
  }
  published(captures: readonly CaptureIndexEntry[]): void { this.captures = captures; }
  remove(item: CaptureIndexEntry): void { this.relations.delete(item.id); this.captures = this.captures.filter((capture) => capture.id !== item.id); }
  clear(): void { this.relations.clear(); this.captures = []; }
  metadata(captures: readonly CaptureIndexEntry[]): Map<string, TraceMetadata> {
    const byId = new Map(captures.map((item) => [item.id, item]));
    const root = (id: string) => { const seen = new Set<string>(); let current = id; while (!seen.has(current)) { seen.add(current); const parent = this.getParentId(current); if (!parent || !byId.has(parent)) return current; current = parent; } return current; };
    const groups = new Map<string, { id: string; source: TraceGroupSource; captures: CaptureIndexEntry[] }>();
    for (const capture of captures) {
      const source: TraceGroupSource = capture.trace_id ? 'explicit' : 'inferred'; const id = capture.trace_id ?? root(capture.id); const key = `${source}\0${id}`;
      const group = groups.get(key) ?? { id, source, captures: [] }; group.captures.push(capture); groups.set(key, group);
    }
    const result = new Map<string, TraceMetadata>();
    for (const group of groups.values()) if (group.source === 'explicit' || group.captures.length >= 2) group.captures.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)).forEach((capture, index) => result.set(capture.id, { trace_group_id: group.id, trace_group_source: group.source, trace_group_index: index + 1 }));
    return result;
  }
  async result(selectedId: string, captures: readonly CaptureIndexEntry[], readCapture: (id: string) => Promise<Capture | null>, parseRequest: (adapterId: string, body: string) => ProviderRequest, parseResponse: (adapterId: string, body: string, contentType?: string) => ProviderResponse): Promise<TraceResult | null> {
    const selected = captures.find((item) => item.id === selectedId); if (!selected || !(await readCapture(selectedId))) return null;
    const source = selected.trace_id ? 'explicit' as const : 'inferred' as const; const byId = new Map(captures.map((item) => [item.id, item])); let truncated = false;
    let entries: CaptureIndexEntry[];
    if (source === 'explicit') entries = captures.filter((item) => item.trace_id === selected.trace_id);
    else { entries = []; const seen = new Set<string>(); let current: CaptureIndexEntry | undefined = selected; while (current && !seen.has(current.id)) { entries.push(current); seen.add(current.id); const parent = this.getParentId(current.id); if (!parent) break; current = byId.get(parent); if (!current) truncated = true; } entries.reverse(); }
    entries.sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
    const parsed = new Map<string, Parsed>(); for (const entry of entries) parsed.set(entry.id, this.parsed(await readCapture(entry.id), parseRequest, parseResponse));
    const calls = entries.map((item, index) => {
      const current = parsed.get(item.id)!; const parentId = this.getParentId(item.id); const parent = parentId ? parsed.get(parentId) ?? null : null;
      const delta = parent ? this.inputDelta(current.conversation, parent.conversation, parent.output) : { relation: parentId || index > 0 ? 'rewritten' as const : 'root' as const, delta: current.conversation };
      return { capture_id: item.id, timestamp: item.timestamp, model: item.model, response_status: item.response_status, upstream_host: item.upstream_host, input_relation: delta.relation, input_delta: delta.delta, output: current.output };
    });
    return { id: selected.trace_id ?? entries[0]?.id ?? selected.id, source, selected_capture_id: selected.id, truncated, calls };
  }
  private parsed(capture: Capture | null, parseRequest: (adapterId: string, body: string) => ProviderRequest, parseResponse: (adapterId: string, body: string, contentType?: string) => ProviderResponse): Parsed {
    if (!capture) return { conversation: [], output: null };
    const conversation = capture.prompt_input?.conversation ?? this.readConversation(capture, parseRequest); const output = capture.model_output ?? this.readOutput(capture, parseResponse); return { conversation, output };
  }
  private readConversation(capture: Capture, parseRequest: (adapterId: string, body: string) => ProviderRequest): ConversationMessage[] { if (!capture.request?.body || !capture.adapter_id || capture.adapter_id === 'unresolved') return []; try { return parseRequest(capture.adapter_id, capture.request.body).input.conversation ?? []; } catch { return []; } }
  private readOutput(capture: Capture, parseResponse: (adapterId: string, body: string, contentType?: string) => ProviderResponse): ModelOutputSnapshot | null { if (!capture.response?.body || !capture.adapter_id || capture.adapter_id === 'unresolved') return null; const contentType = Object.entries(capture.response.headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1]; try { return parseResponse(capture.adapter_id, capture.response.body, Array.isArray(contentType) ? contentType[0] : contentType).output; } catch { return null; } }
  private conversationStartsWith(value: ConversationMessage[], prefix: ConversationMessage[]): boolean { return prefix.length > 0 && prefix.length <= value.length && prefix.every((item, index) => equal(item, value[index])); }
  private inputDelta(current: ConversationMessage[], previous: ConversationMessage[], previousOutput: ModelOutputSnapshot | null): { relation: TraceInputRelation; delta: ConversationMessage[] } {
    const content: ConversationContentBlock[] = (previousOutput?.content ?? []).filter((block) => block.type !== 'unknown' || block.visibility !== 'internal'); const assistant = content.length ? { role: previousOutput?.role ?? 'assistant', content } : null;
    const expected = assistant ? [...previous, assistant] : previous;
    if (this.conversationStartsWith(current, expected)) return { relation: 'append', delta: current.slice(expected.length) };
    if (this.conversationStartsWith(current, previous)) return { relation: 'append', delta: current.slice(previous.length) };
    return { relation: 'rewritten', delta: current };
  }
}
