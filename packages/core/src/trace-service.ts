import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  Capture,
  CaptureIndexEntry,
  ConversationContentBlock,
  ConversationMessage,
  JsonValue,
  ModelOutputSnapshot,
  TraceInputRelation,
  TraceResult,
} from '@prompt-prism/contracts/server';
import type { ProviderRequest, ProviderResponse } from './types.js';

export type TraceGroupSource = 'explicit' | 'inferred';
export type TraceRelationSource = 'explicit' | 'reference' | 'inferred';
export type TraceRelationReason =
  | 'explicit_trace_id'
  | 'explicit_parent_capture'
  | 'tool_result_reference'
  | 'input_prefix'
  | 'input_with_previous_output';
export type TraceMetadata = { trace_group_id: string; trace_group_source: TraceGroupSource; trace_group_index: number };

type Relation = {
  id: string;
  parent_capture_id: string | null;
  source?: TraceRelationSource;
  reason?: TraceRelationReason;
  version?: 1 | 2;
};
type Parsed = { conversation: ConversationMessage[]; output: ModelOutputSnapshot | null };
type CandidateMatch = { candidate: CaptureIndexEntry; reason: TraceRelationReason; rank: number; prefixLength: number; modelMatch: boolean };
const MAX_INFERENCE_AGE_MS = 30 * 60 * 1000;
const ANONYMOUS_TOKEN_HASH = 'anonymous';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

function equal(left: unknown, right: unknown): boolean { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); }

function primary(capture: Pick<CaptureIndexEntry, 'messages' | 'prompt_input'>): JsonValue[] {
  const input = capture.prompt_input;
  if (input?.primary_sequence) return input.primary_sequence;
  const section = input?.sections.find((item) => item.id === input.primary_section_id);
  return Array.isArray(section?.value) ? section.value : capture.messages;
}

function startsWith(value: JsonValue[], prefix: JsonValue[]): boolean {
  return prefix.length > 0 && prefix.length <= value.length && prefix.every((item, index) => equal(item, value[index]));
}

function entry(capture: Capture, fileRef = ''): CaptureIndexEntry {
  return {
    id: capture.id,
    timestamp: capture.timestamp,
    token_hash: capture.token_hash,
    model: capture.model,
    usage: capture.usage,
    response_status: capture.response?.status,
    upstream_host: capture.upstream_host,
    trace_id: capture.trace_id,
    ...(capture.trace_parent_capture_id ? { trace_parent_capture_id: capture.trace_parent_capture_id } : {}),
    timing: capture.timing,
    file_ref: fileRef,
    messages: capture.messages,
    adapter_id: capture.adapter_id,
    prompt_input: capture.prompt_input,
  };
}

function relationEntry(relation: Relation): Pick<CaptureIndexEntry, 'parent_capture_id' | 'trace_relation_source' | 'trace_relation_reason' | 'trace_relation_version'> {
  return {
    ...(relation.parent_capture_id ? { parent_capture_id: relation.parent_capture_id } : {}),
    ...(relation.source ? { trace_relation_source: relation.source } : {}),
    ...(relation.reason ? { trace_relation_reason: relation.reason } : {}),
    ...(relation.version ? { trace_relation_version: relation.version } : {}),
  };
}

function noRelation(id: string): Relation { return { id, parent_capture_id: null, version: 2 }; }

function relationRank(source: TraceRelationSource | undefined): number {
  return source === 'explicit' ? 3 : source === 'reference' ? 2 : source === 'inferred' ? 1 : 0;
}

function toolResultIds(conversation: ConversationMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of conversation) for (const block of message.content) if (block.type === 'tool_result' && block.tool_call_id) ids.add(block.tool_call_id);
  return ids;
}

function toolCallIds(output: ModelOutputSnapshot | null): Set<string> {
  const ids = new Set<string>();
  for (const block of output?.content ?? []) if (block.type === 'tool_call' && block.id) ids.add(block.id);
  return ids;
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

export class TraceService {
  readonly path: string;
  readonly relations = new Map<string, Relation>();
  private captures: readonly CaptureIndexEntry[] = [];
  private unresolved = new Set<string>();

  constructor(dataDir: string) { this.path = path.join(dataDir, 'trace.jsonl'); }

  async init(captures: readonly CaptureIndexEntry[]): Promise<void> {
    this.captures = captures;
    try {
      const content = await readFile(this.path, 'utf8');
      const ids = new Set(captures.map((item) => item.id));
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        const value = JSON.parse(line) as Relation;
        if (typeof value.id !== 'string' || !ids.has(value.id)) continue;
        if (typeof value.parent_capture_id !== 'string' && value.parent_capture_id !== null) continue;
        if (value.version !== undefined && value.version !== 1 && value.version !== 2) continue;
        this.relations.set(value.id, value);
        if (!value.source && value.parent_capture_id === null) this.unresolved.add(value.id);
        if (value.source === 'explicit' && value.parent_capture_id === null && captures.find((capture) => capture.id === value.id)?.trace_id) this.unresolved.add(value.id);
      }
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error;
    }
    for (const capture of captures) {
      if (this.relations.has(capture.id)) continue;
      const relation: Relation = capture.trace_id
        ? { id: capture.id, parent_capture_id: capture.parent_capture_id ?? null, source: 'explicit', reason: 'explicit_trace_id', version: 1 }
        : {
          id: capture.id,
          parent_capture_id: capture.parent_capture_id ?? null,
          source: capture.trace_relation_source,
          reason: capture.trace_relation_reason,
          version: capture.trace_relation_version,
        };
      this.relations.set(capture.id, relation);
      if (!relation.source || (capture.trace_parent_capture_id && !relation.parent_capture_id) || (capture.trace_id && !relation.parent_capture_id)) this.unresolved.add(capture.id);
    }
  }

  getParentId = (id: string): string | null | undefined => this.relations.get(id)?.parent_capture_id;

  async prepare(
    capture: Capture,
    stored: CaptureIndexEntry,
    readCapture: (id: string) => Promise<Capture | null>,
    parseRequest: (adapterId: string, body: string) => ProviderRequest,
    parseResponse: (adapterId: string, body: string, contentType?: string) => ProviderResponse,
  ): Promise<CaptureIndexEntry> {
    const current = { ...stored, ...entry(capture, stored.file_ref) };
    const relation = await this.resolveRelation(capture, current, this.captures, readCapture, parseRequest, parseResponse);
    await this.persist(relation);
    this.apply(relation, capture);
    return { ...stored, ...relationEntry(relation) };
  }

  /** Re-evaluate unresolved captures after a late/out-of-order capture is published. */
  async reconcile(
    captures: readonly CaptureIndexEntry[],
    readCapture: (id: string) => Promise<Capture | null>,
    parseRequest: (adapterId: string, body: string) => ProviderRequest,
    parseResponse: (adapterId: string, body: string, contentType?: string) => ProviderResponse,
    focusId?: string,
  ): Promise<string[]> {
    this.captures = captures;
    const byId = new Map(captures.map((item) => [item.id, item]));
    const focus = focusId ? byId.get(focusId) : undefined;
    const focusCapture = focus ? await readCapture(focus.id) : null;
    const focusParsed = focusCapture ? this.parsed(focusCapture, parseRequest, parseResponse) : null;
    const changed: string[] = [];
    for (const id of [...this.unresolved]) {
      if (id === focusId) continue;
      const current = byId.get(id);
      if (!current) { this.unresolved.delete(id); continue; }
      if (focus && focusParsed && !this.mayRelate(current, focus, focusParsed)) continue;
      const capture = await readCapture(id);
      if (!capture) continue;
      const previous = this.relations.get(id);
      const next = await this.resolveRelation(capture, current, captures.filter((item) => item.id !== id), readCapture, parseRequest, parseResponse);
      if (!next.parent_capture_id || !this.canUpgrade(previous, next)) continue;
      await this.persist(next);
      this.apply(next, capture);
      changed.push(id);
    }
    return changed;
  }

  private mayRelate(current: CaptureIndexEntry, focus: CaptureIndexEntry, focusParsed: Parsed): boolean {
    if (current.trace_parent_capture_id === focus.id) return true;
    if (!current.prompt_input || !focus.prompt_input) return false;
    if (startsWith(primary(current), primary(focus))) return true;
    const currentConversation = current.prompt_input.conversation ?? [];
    if (intersects(toolResultIds(currentConversation), toolCallIds(focusParsed.output))) return true;
    const assistantContent = focusParsed.output?.content.filter((block) => block.type !== 'unknown' || block.visibility !== 'internal') ?? [];
    const assistant = assistantContent.length ? { role: focusParsed.output?.role ?? 'assistant', content: assistantContent } : null;
    return Boolean(assistant && this.conversationStartsWith(currentConversation, [...focusParsed.conversation, assistant]));
  }

  private async persist(relation: Relation): Promise<void> {
    await appendFile(this.path, `${JSON.stringify({ ...relation, version: relation.version ?? 2 })}\n`);
  }

  private apply(relation: Relation, capture?: Capture): void {
    this.relations.set(relation.id, relation);
    if (relation.parent_capture_id || relation.source === 'explicit' && !capture?.trace_parent_capture_id && !capture?.trace_id) this.unresolved.delete(relation.id);
    else this.unresolved.add(relation.id);
  }

  private canUpgrade(previous: Relation | undefined, next: Relation): boolean {
    if (!next.parent_capture_id) return false;
    if (!previous?.parent_capture_id) return true;
    if (previous.parent_capture_id === next.parent_capture_id) return false;
    return relationRank(next.source) > relationRank(previous.source);
  }

  private async resolveRelation(
    capture: Capture,
    current: CaptureIndexEntry,
    candidates: readonly CaptureIndexEntry[],
    readCapture: (id: string) => Promise<Capture | null>,
    parseRequest: (adapterId: string, body: string) => ProviderRequest,
    parseResponse: (adapterId: string, body: string, contentType?: string) => ProviderResponse,
  ): Promise<Relation> {
    const requestedParent = capture.trace_parent_capture_id ?? current.trace_parent_capture_id;
    const explicitParent = requestedParent ? candidates.find((item) => item.id === requestedParent) : undefined;
    const explicitTraceRelation = (): Relation => ({ id: capture.id, parent_capture_id: null, source: 'explicit', reason: 'explicit_trace_id', version: 2 });
    if (capture.trace_id && explicitParent) return { id: capture.id, parent_capture_id: explicitParent.id, source: 'explicit', reason: 'explicit_parent_capture', version: 2 };
    if (capture.trace_id && requestedParent) return explicitTraceRelation();
    if (requestedParent) {
      if (explicitParent) return { id: capture.id, parent_capture_id: explicitParent.id, source: 'reference', reason: 'explicit_parent_capture', version: 2 };
      return noRelation(capture.id);
    }
    if (!capture.prompt_input) return capture.trace_id ? explicitTraceRelation() : noRelation(capture.id);
    const currentPrimary = primary(current);
    const currentTime = Date.parse(current.timestamp);
    if (!Number.isFinite(currentTime) || !currentPrimary.length || current.token_hash === ANONYMOUS_TOKEN_HASH) return capture.trace_id ? explicitTraceRelation() : noRelation(capture.id);
    const currentConversation = capture.prompt_input.conversation ?? [];
    const currentToolResults = toolResultIds(currentConversation);
    const matches: CandidateMatch[] = [];
    for (const candidate of candidates) {
      if (!candidate.prompt_input || !this.heuristicCompatible(current, candidate)) continue;
      if (capture.trace_id ? candidate.trace_id !== capture.trace_id : Boolean(candidate.trace_id)) continue;
      const age = currentTime - Date.parse(candidate.timestamp);
      if (!Number.isFinite(age) || age < 0 || age > MAX_INFERENCE_AGE_MS) continue;
      const candidatePrimary = primary(candidate);
      const inputPrefix = startsWith(currentPrimary, candidatePrimary);
      const candidateConversation = candidate.prompt_input.conversation ?? [];
      const conversationPrefix = candidateConversation.length === 0 || this.conversationStartsWith(currentConversation, candidateConversation);
      if (!currentToolResults.size && !inputPrefix && !conversationPrefix) continue;
      const prior = await readCapture(candidate.id);
      const parsed = this.parsed(prior, parseRequest, parseResponse);
      const parsedConversation = candidateConversation.length > 0 ? candidateConversation : parsed.conversation;
      const candidateTools = toolCallIds(parsed.output);
      if (intersects(currentToolResults, candidateTools)) {
        matches.push({ candidate, reason: 'tool_result_reference', rank: 4, prefixLength: 0, modelMatch: current.model === candidate.model });
        continue;
      }
      const assistantContent = parsed.output?.content.filter((block) => block.type !== 'unknown' || block.visibility !== 'internal') ?? [];
      const assistant = assistantContent.length ? { role: parsed.output?.role ?? 'assistant', content: assistantContent } : null;
      if (assistant && this.conversationStartsWith(currentConversation, [...parsedConversation, assistant])) {
        matches.push({ candidate, reason: 'input_with_previous_output', rank: 3, prefixLength: parsedConversation.length, modelMatch: current.model === candidate.model });
        continue;
      }
      if (startsWith(currentPrimary, candidatePrimary)) matches.push({ candidate, reason: 'input_prefix', rank: 2, prefixLength: candidatePrimary.length, modelMatch: current.model === candidate.model });
    }
    if (!matches.length) return capture.trace_id ? explicitTraceRelation() : noRelation(capture.id);
    const bestRank = Math.max(...matches.map((match) => match.rank));
    const best = matches.filter((match) => match.rank === bestRank);
    const longest = Math.max(...best.map((match) => match.prefixLength));
    const longestMatches = best.filter((match) => match.prefixLength === longest);
    const modelMatches = longestMatches.filter((match) => match.modelMatch);
    const selected = modelMatches.length ? modelMatches : longestMatches;
    if (selected.length !== 1) return capture.trace_id ? explicitTraceRelation() : noRelation(capture.id);
    const match = selected[0]!;
    return { id: capture.id, parent_capture_id: match.candidate.id, source: match.reason === 'tool_result_reference' ? 'reference' : 'inferred', reason: match.reason, version: 2 };
  }

  private heuristicCompatible(current: CaptureIndexEntry, candidate: CaptureIndexEntry): boolean {
    const currentAdapter = current.prompt_input?.adapter_id ?? current.adapter_id;
    const candidateAdapter = candidate.prompt_input?.adapter_id ?? candidate.adapter_id;
    if (!currentAdapter || currentAdapter !== candidateAdapter) return false;
    if ((current.upstream_host ?? '') !== (candidate.upstream_host ?? '')) return false;
    if (current.token_hash === ANONYMOUS_TOKEN_HASH || candidate.token_hash === ANONYMOUS_TOKEN_HASH) return false;
    return current.token_hash === candidate.token_hash;
  }

  private parsed(capture: Capture | null, parseRequest: (adapterId: string, body: string) => ProviderRequest, parseResponse: (adapterId: string, body: string, contentType?: string) => ProviderResponse): Parsed {
    if (!capture) return { conversation: [], output: null };
    const conversation = capture.prompt_input?.conversation ?? this.readConversation(capture, parseRequest);
    const output = capture.model_output ?? this.readOutput(capture, parseResponse);
    return { conversation, output };
  }

  private readConversation(capture: Capture, parseRequest: (adapterId: string, body: string) => ProviderRequest): ConversationMessage[] {
    if (!capture.request?.body || !capture.adapter_id || capture.adapter_id === 'unresolved') return [];
    try { return parseRequest(capture.adapter_id, capture.request.body).input.conversation ?? []; } catch { return []; }
  }

  private readOutput(capture: Capture, parseResponse: (adapterId: string, body: string, contentType?: string) => ProviderResponse): ModelOutputSnapshot | null {
    if (!capture.response?.body || !capture.adapter_id || capture.adapter_id === 'unresolved') return null;
    const contentType = Object.entries(capture.response.headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
    try { return parseResponse(capture.adapter_id, capture.response.body, Array.isArray(contentType) ? contentType[0] : contentType).output; } catch { return null; }
  }

  published(captures: readonly CaptureIndexEntry[]): void {
    this.captures = captures;
    const ids = new Set(captures.map((capture) => capture.id));
    for (const id of [...this.unresolved]) if (!ids.has(id)) this.unresolved.delete(id);
  }

  remove(item: CaptureIndexEntry): void {
    this.relations.delete(item.id);
    this.unresolved.delete(item.id);
    this.captures = this.captures.filter((capture) => capture.id !== item.id);
  }

  clear(): void { this.relations.clear(); this.unresolved.clear(); this.captures = []; }

  metadata(captures: readonly CaptureIndexEntry[]): Map<string, TraceMetadata> {
    const byId = new Map(captures.map((item) => [item.id, item]));
    const root = (id: string) => {
      const seen = new Set<string>();
      let current = id;
      while (!seen.has(current)) {
        seen.add(current);
        const parent = this.getParentId(current);
        if (!parent || !byId.has(parent)) return current;
        current = parent;
      }
      return current;
    };
    const groups = new Map<string, { id: string; source: TraceGroupSource; captures: CaptureIndexEntry[] }>();
    for (const capture of captures) {
      const rootId = root(capture.id);
      const rootCapture = byId.get(rootId);
      const explicitId = capture.trace_id ?? rootCapture?.trace_id;
      const source: TraceGroupSource = explicitId ? 'explicit' : 'inferred';
      const id = explicitId ?? rootId;
      const key = `${source}\0${id}`;
      const group = groups.get(key) ?? { id, source, captures: [] };
      group.captures.push(capture);
      groups.set(key, group);
    }
    const result = new Map<string, TraceMetadata>();
    for (const group of groups.values()) {
      if (group.source === 'explicit' || group.captures.length >= 2) {
        group.captures
          .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id))
          .forEach((capture, index) => result.set(capture.id, { trace_group_id: group.id, trace_group_source: group.source, trace_group_index: index + 1 }));
      }
    }
    return result;
  }

  async result(
    selectedId: string,
    captures: readonly CaptureIndexEntry[],
    readCapture: (id: string) => Promise<Capture | null>,
    parseRequest: (adapterId: string, body: string) => ProviderRequest,
    parseResponse: (adapterId: string, body: string, contentType?: string) => ProviderResponse,
  ): Promise<TraceResult | null> {
    const selected = captures.find((item) => item.id === selectedId);
    if (!selected || !(await readCapture(selectedId))) return null;
    const source = selected.trace_id ? 'explicit' as const : 'inferred' as const;
    const byId = new Map(captures.map((item) => [item.id, item]));
    let truncated = false;
    let entries: CaptureIndexEntry[];
    if (source === 'explicit') entries = captures.filter((item) => item.trace_id === selected.trace_id);
    else {
      entries = [];
      const seen = new Set<string>();
      let current: CaptureIndexEntry | undefined = selected;
      while (current && !seen.has(current.id)) {
        entries.push(current);
        seen.add(current.id);
        const parent = this.getParentId(current.id);
        if (!parent) break;
        current = byId.get(parent);
        if (!current) truncated = true;
      }
      entries.reverse();
    }
    entries.sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
    const parsed = new Map<string, Parsed>();
    for (const item of entries) parsed.set(item.id, this.parsed(await readCapture(item.id), parseRequest, parseResponse));
    const calls = entries.map((item, index) => {
      const current = parsed.get(item.id)!;
      const parentId = this.getParentId(item.id);
      const parent = parentId ? parsed.get(parentId) ?? null : null;
      const delta = parent ? this.inputDelta(current.conversation, parent.conversation, parent.output) : { relation: parentId || index > 0 ? 'rewritten' as const : 'root' as const, delta: current.conversation };
      const relation = this.relations.get(item.id);
      return {
        capture_id: item.id,
        timestamp: item.timestamp,
        model: item.model,
        response_status: item.response_status,
        upstream_host: item.upstream_host,
        input_relation: delta.relation,
        input_delta: delta.delta,
        output: current.output,
        ...(parentId ? { parent_capture_id: parentId } : {}),
        ...(relation?.source ? { relation_source: relation.source } : {}),
        ...(relation?.reason ? { relation_reason: relation.reason } : {}),
      };
    });
    return { id: selected.trace_id ?? entries[0]?.trace_id ?? entries[0]?.id ?? selected.id, source, selected_capture_id: selected.id, truncated, calls };
  }

  private conversationStartsWith(value: ConversationMessage[], prefix: ConversationMessage[]): boolean {
    return prefix.length > 0 && prefix.length <= value.length && prefix.every((item, index) => equal(item, value[index]));
  }

  private inputDelta(current: ConversationMessage[], previous: ConversationMessage[], previousOutput: ModelOutputSnapshot | null): { relation: TraceInputRelation; delta: ConversationMessage[] } {
    const content: ConversationContentBlock[] = (previousOutput?.content ?? []).filter((block) => block.type !== 'unknown' || block.visibility !== 'internal');
    const assistant = content.length ? { role: previousOutput?.role ?? 'assistant', content } : null;
    const expected = assistant ? [...previous, assistant] : previous;
    if (this.conversationStartsWith(current, expected)) return { relation: 'append', delta: current.slice(expected.length) };
    if (this.conversationStartsWith(current, previous)) return { relation: 'append', delta: current.slice(previous.length) };
    return { relation: 'rewritten', delta: current };
  }
}
