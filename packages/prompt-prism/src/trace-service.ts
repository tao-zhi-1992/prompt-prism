import { appendFile, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Capture, CaptureIndexEntry, JsonValue, ModelInputSnapshot } from './types.js';

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
}
