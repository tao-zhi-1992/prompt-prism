import { appendFile, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { diffCharacters, divergencePoint, type DiffPart } from './diff.js';
import type { Capture, CaptureIndexEntry, JsonValue, Message, ModelInputSection, ModelInputSnapshot } from '../../contracts/server.js';

export type InputDiffSectionState = 'changed' | 'unchanged' | 'baseline' | 'empty' | 'unavailable';

export interface InputDiffSection {
  id: string;
  label: string;
  order: number;
  state: InputDiffSectionState;
  default_collapsed: boolean;
  diff: DiffPart[];
}

export interface InputDiffAnalysis {
  id: string;
  timestamp: string;
  matched_parent_id: string | null;
  matched_message_count: number;
  divergence_point: number;
  diff: DiffPart[];
  sections?: InputDiffSection[];
  estimated_cacheable_tokens: number;
  actual_cache_read_tokens: number;
  estimated_cache_miss: number;
  cache_hit_below_expected: boolean;
}

interface ParentMatch {
  capture: CaptureIndexEntry;
  input: ModelInputSnapshot;
  score: { items: number; chars: number };
}

export function serializeValue(value: JsonValue): string {
  return JSON.stringify(value);
}

function commonSequencePrefix(left: JsonValue, right: JsonValue): number {
  if (!Array.isArray(left) || !Array.isArray(right)) return 0;
  let count = 0;
  while (count < left.length && count < right.length && serializeValue(left[count] ?? null) === serializeValue(right[count] ?? null)) count++;
  return count;
}

function legacyInput(capture: Pick<CaptureIndexEntry, 'adapter_id' | 'messages' | 'prompt_input'>): ModelInputSnapshot {
  return capture.prompt_input ?? {
    adapter_id: capture.adapter_id ?? 'anthropic',
    primary_section_id: 'messages',
    primary_sequence: capture.messages,
    sections: [{ id: 'messages', label: 'Messages', order: 10, value: capture.messages, compare_as: 'sequence', default_collapsed: false }],
  };
}

function section(snapshot: ModelInputSnapshot, id: string): ModelInputSection | undefined {
  return snapshot.sections.find((item) => item.id === id);
}

function isEmpty(value: JsonValue): boolean {
  if (value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === 'object' && Object.keys(value).length === 0;
}

function groupKey(capture: Pick<CaptureIndexEntry, 'adapter_id' | 'model' | 'token_hash' | 'upstream_host' | 'prompt_input'>): string {
  return JSON.stringify([
    capture.prompt_input?.adapter_id ?? capture.adapter_id ?? 'anthropic',
    capture.token_hash,
    capture.upstream_host ?? '',
    capture.model ?? '',
  ]);
}

function indexEntry(capture: Capture): CaptureIndexEntry {
  return {
    id: capture.id,
    timestamp: capture.timestamp,
    token_hash: capture.token_hash,
    model: capture.model,
    usage: capture.usage,
    response_status: capture.response?.status,
    upstream_host: capture.upstream_host,
    trace_id: capture.trace_id,
    timing: capture.timing,
    file_ref: '',
    messages: capture.messages,
    adapter_id: capture.adapter_id,
    prompt_input: capture.prompt_input,
  };
}

function buildSections(current: ModelInputSnapshot, parent: ModelInputSnapshot | null): InputDiffSection[] {
  const ordered = [...current.sections].sort((left, right) => left.order - right.order);
  for (const oldSection of parent?.sections ?? []) if (!ordered.some(({ id }) => id === oldSection.id)) ordered.push(oldSection);
  return ordered.map((currentSection) => {
    const oldSection = parent ? section(parent, currentSection.id) : undefined;
    const newSection = section(current, currentSection.id);
    const oldText = serializeValue(oldSection?.value ?? null);
    const newValue = newSection?.value ?? null;
    const newText = serializeValue(newValue);
    const empty = isEmpty(newValue) && (!parent || isEmpty(oldSection?.value ?? null));
    const state: InputDiffSectionState = empty ? 'empty' : !parent ? 'baseline' : oldText === newText ? 'unchanged' : 'changed';
    return {
      id: currentSection.id,
      label: currentSection.label,
      order: currentSection.order,
      state,
      default_collapsed: currentSection.default_collapsed,
      diff: parent ? diffCharacters(oldText, newText) : [{ type: 'insert', value: newText }],
    };
  });
}

export class InputDiffAnalyzer {
  readonly analysisPath: string;
  readonly index = new Map<string, CaptureIndexEntry[]>();
  readonly analyses = new Map<string, InputDiffAnalysis>();

  constructor({ analysisPath }: { analysisPath: string }) {
    this.analysisPath = analysisPath;
  }

  async init(captures: readonly CaptureIndexEntry[] = []): Promise<void> {
    const content = await readOptionalFile(this.analysisPath);
    if (content !== null) {
      const lines = content.split('\n');
      const completeTail = content.endsWith('\n');
      const captureIds = new Set(captures.map(({ id }) => id));
      let needsRewrite = content.length > 0 && !completeTail;
      for (const [index, line] of lines.entries()) {
        if (!line.trim()) continue;
        let value: unknown;
        try {
          value = JSON.parse(line);
        }
        catch (error: unknown) {
          if (!completeTail && index === lines.length - 1) {
            needsRewrite = true;
            break;
          }
          throw new Error(`Invalid analysis record at line ${index + 1}`, { cause: error });
        }
        if (!isInputDiffAnalysis(value)) throw new Error(`Invalid analysis record at line ${index + 1}`);
        const item = value;
        if (!captureIds.has(item.id)) {
          needsRewrite = true;
          continue;
        }
        if (this.analyses.has(item.id)) needsRewrite = true;
        this.analyses.set(item.id, item);
      }
      if (needsRewrite) await this.rewriteAnalyses();
    }
    for (const capture of captures) this.addToIndex(capture);
  }

  private async rewriteAnalyses(): Promise<void> {
    const content = [...this.analyses.values()].map((item) => JSON.stringify(item)).join('\n');
    const temporaryPath = `${this.analysisPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, content ? `${content}\n` : '', { flag: 'wx' });
      await rename(temporaryPath, this.analysisPath);
    } finally {
      await unlinkIfPresent(temporaryPath);
    }
  }

  findParent(capture: Capture): ParentMatch | null {
    const current = legacyInput(capture);
    const primary = current.primary_sequence ?? section(current, current.primary_section_id)?.value ?? [];
    let best: ParentMatch | null = null;
    for (const candidate of this.index.get(groupKey(capture)) ?? []) {
      if (capture.prompt_input && !candidate.prompt_input) continue;
      const candidateInput = legacyInput(candidate);
      const candidatePrimary = candidateInput.primary_sequence ?? section(candidateInput, candidateInput.primary_section_id)?.value ?? [];
      const items = commonSequencePrefix(candidatePrimary, primary);
      if (items === 0) continue;
      const chars = divergencePoint(serializeValue(candidatePrimary), serializeValue(primary));
      const newer = new Date(candidate.timestamp).getTime() > new Date(best?.capture.timestamp ?? 0).getTime();
      if (!best || items > best.score.items || (items === best.score.items && (chars > best.score.chars || (chars === best.score.chars && newer)))) {
        best = { capture: candidate, input: candidateInput, score: { items, chars } };
      }
    }
    return best;
  }

  async analyze(capture: Capture, stored: CaptureIndexEntry = indexEntry(capture), parentOverride?: CaptureIndexEntry | null): Promise<InputDiffAnalysis> {
    const currentInput = legacyInput(capture);
    const currentPrimary = currentInput.primary_sequence ?? section(currentInput, currentInput.primary_section_id)?.value ?? [];
    const currentText = serializeValue(currentPrimary);
    const parent = parentOverride === undefined ? this.findParent(capture) : parentOverride ? { capture: parentOverride, input: legacyInput(parentOverride), score: { items: commonSequencePrefix(parentOverride.prompt_input?.primary_sequence ?? parentOverride.messages, currentPrimary), chars: 0 } } : null;
    const parentPrimary = parent ? parent.input.primary_sequence ?? section(parent.input, parent.input.primary_section_id)?.value ?? [] : [];
    const parentText = serializeValue(parentPrimary);
    const point = parent ? divergencePoint(parentText, currentText) : 0;
    const actual = capture.usage?.cache_read_input_tokens ?? 0;
    const expected = Math.floor(point / 4);
    const sections = buildSections(currentInput, parent?.input ?? null);
    const primaryDiff = sections.find(({ id }) => id === currentInput.primary_section_id)?.diff ?? [{ type: 'insert' as const, value: currentText }];
    const analysis: InputDiffAnalysis = {
      id: capture.id,
      timestamp: capture.timestamp,
      matched_parent_id: parent?.capture.id ?? null,
      matched_message_count: parent?.score.items ?? 0,
      divergence_point: point,
      diff: primaryDiff,
      sections,
      estimated_cacheable_tokens: expected,
      actual_cache_read_tokens: actual,
      estimated_cache_miss: Math.max(0, expected - actual),
      cache_hit_below_expected: expected >= 32 && actual < expected * 0.8,
    };
    await appendFile(this.analysisPath, `${JSON.stringify(analysis)}\n`);
    this.analyses.set(capture.id, analysis);
    this.addToIndex(stored);
    return analysis;
  }

  addToIndex(capture: CaptureIndexEntry): void {
    const key = groupKey(capture);
    const entries = this.index.get(key) ?? [];
    entries.push(capture);
    this.index.set(key, entries);
  }

  remove(entry: CaptureIndexEntry): void {
    this.analyses.delete(entry.id);
    const key = groupKey(entry);
    this.index.set(key, (this.index.get(key) ?? []).filter((item) => item.id !== entry.id));
  }

  clear(): void {
    this.analyses.clear();
    this.index.clear();
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInputDiffAnalysis(value: unknown): value is InputDiffAnalysis {
  return isObject(value)
    && typeof value.id === 'string' && value.id.length > 0
    && typeof value.timestamp === 'string' && !Number.isNaN(Date.parse(value.timestamp))
    && (typeof value.matched_parent_id === 'string' || value.matched_parent_id === null)
    && typeof value.matched_message_count === 'number'
    && typeof value.divergence_point === 'number'
    && Array.isArray(value.diff)
    && typeof value.estimated_cacheable_tokens === 'number'
    && typeof value.actual_cache_read_tokens === 'number'
    && typeof value.estimated_cache_miss === 'number'
    && typeof value.cache_hit_below_expected === 'boolean';
}

async function unlinkIfPresent(filename: string): Promise<void> {
  try { await unlink(filename); }
  catch (error: unknown) { if (!isMissingFile(error)) throw error; }
}

async function readOptionalFile(filename: string): Promise<string | null> {
  try { return await readFile(filename, 'utf8'); }
  catch (error: unknown) { if (isMissingFile(error)) return null; throw error; }
}
