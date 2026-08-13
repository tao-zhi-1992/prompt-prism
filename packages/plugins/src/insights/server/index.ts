import { createHash } from 'node:crypto';
import type {
  Capture,
  CaptureIndexEntry,
  CaptureTiming,
  ConversationContentBlock,
  JsonValue,
  ModelInputSection,
  PromptPrismServerPlugin,
  ServerPluginContext,
  Usage,
} from '@prompt-prism/contracts/server';
import { insightsPluginMeta } from '../index.js';
import type { TraceInputRelation, TraceResult } from '@prompt-prism/contracts/server';

type ParentLookup = (id: string) => string | null | undefined;

function parseConversation(capture: Capture, context: ServerPluginContext) {
  if (!capture.request?.body) return [];
  try { return context.parseProviderRequest(capture.adapter_id ?? 'anthropic', capture.request.body).input.conversation ?? []; }
  catch { return []; }
}
function parseOutput(capture: Capture, context: ServerPluginContext) {
  if (!capture.response?.body) return null;
  const contentType = Object.entries(capture.response.headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
  try { return context.parseProviderResponse(capture.adapter_id ?? 'anthropic', capture.response.body, Array.isArray(contentType) ? contentType[0] : contentType).output; }
  catch { return null; }
}

const SCHEMA_VERSION = 1 as const;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_EVIDENCE_BYTES = 64 * 1024;
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const LARGE_TOOL_RESULT_BYTES = 16 * 1024;
const LOW_CACHE_MIN_TOKENS = 1024;
const LOW_CACHE_RATE = 0.5;

export interface InsightTokenMetrics {
  uncached_input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_write_input_tokens: number;
  input_total_tokens: number;
  cache_hit_rate: number | null;
}

export interface InsightTimingMetrics {
  trace_span_ms: number | null;
  model_duration_ms: number | null;
  average_time_to_first_byte_ms: number | null;
  inter_call_gap_ms: number | null;
}

export interface InsightRunSummary {
  run_id: string;
  trace_id: string | null;
  source: 'explicit' | 'inferred';
  truncated: boolean;
  started_at: string;
  completed_at: string;
  calls: number;
  models: string[];
  upstream_hosts: string[];
  response_statuses: number[];
  status: 'ok' | 'error' | 'unknown';
  tokens: InsightTokenMetrics;
  timing: InsightTimingMetrics;
}

export interface InsightSectionMetrics {
  id: string;
  label: string;
  chars: number;
  bytes: number;
  fingerprint: string;
  changes: number;
}

export interface InsightToolNameMetrics {
  name: string;
  calls: number;
  errors: number;
  invalid_arguments: number;
  repeated_calls: number;
  result_bytes: number;
}

export interface InsightToolMetrics {
  calls: number;
  errors: number;
  invalid_arguments: number;
  repeated_calls: number;
  result_bytes: number;
  by_name: InsightToolNameMetrics[];
}

export interface InsightEvidenceLocation {
  capture_id: string;
  section?: string;
  tool?: string;
  metric?: string;
  value?: string | number | boolean | null;
  threshold?: number;
}

export interface InsightFinding {
  code: string;
  scope: string;
  severity: 'info' | 'warning' | 'error';
  summary: string;
  recommendation: string;
  evidence: InsightEvidenceLocation[];
}

export interface InsightCallMetrics {
  capture_id: string;
  timestamp: string;
  model: string | null;
  upstream_host?: string;
  response_status?: number | null;
  input_relation: TraceInputRelation;
  usage: Usage;
  timing: CaptureTiming | null;
  sections: Omit<InsightSectionMetrics, 'changes'>[];
  tool_calls: number;
  tool_results: number;
  tool_errors: number;
  tool_result_bytes: number;
  output_blocks: Record<string, number>;
  stop_reason: string | null;
}

export interface InsightReport {
  schema_version: typeof SCHEMA_VERSION;
  run: InsightRunSummary;
  sections: InsightSectionMetrics[];
  tools: InsightToolMetrics;
  calls: InsightCallMetrics[];
  findings: InsightFinding[];
}

export interface InsightMetricDelta {
  before: number | null;
  after: number | null;
  absolute: number | null;
  percent: number | null;
}

export interface InsightComparison {
  schema_version: typeof SCHEMA_VERSION;
  baseline: InsightRunSummary;
  candidate: InsightRunSummary;
  metrics: Record<string, InsightMetricDelta>;
  tools_by_name: Array<{ name: string; calls: InsightMetricDelta; errors: InsightMetricDelta; repeated_calls: InsightMetricDelta; result_bytes: InsightMetricDelta }>;
  findings: { added: InsightFinding[]; resolved: InsightFinding[]; persisting: InsightFinding[] };
}

export interface InsightEvidence {
  schema_version: typeof SCHEMA_VERSION;
  capture_id: string;
  section: string;
  encoding: 'json';
  content: string;
  original_bytes: number;
  returned_bytes: number;
  truncated: boolean;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex').slice(0, 16);
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function aggregateTokens(entries: readonly Pick<CaptureIndexEntry, 'usage'>[]): InsightTokenMetrics {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  for (const { usage } of entries) {
    input += usage.input_tokens ?? 0;
    output += usage.output_tokens ?? 0;
    cacheRead += usage.cache_read_input_tokens ?? 0;
    cacheWrite += usage.cache_creation_input_tokens ?? 0;
  }
  const total = input + cacheRead + cacheWrite;
  return {
    uncached_input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: cacheRead,
    cache_write_input_tokens: cacheWrite,
    input_total_tokens: total,
    cache_hit_rate: total > 0 && entries.some(({ usage }) => 'cache_read_input_tokens' in usage || 'cache_creation_input_tokens' in usage) ? cacheRead / total : null,
  };
}

function timingMetrics(entries: readonly CaptureIndexEntry[]): InsightTimingMetrics {
  const timed = entries.filter((entry): entry is CaptureIndexEntry & { timing: CaptureTiming } => Boolean(entry.timing));
  if (!timed.length) return { trace_span_ms: null, model_duration_ms: null, average_time_to_first_byte_ms: null, inter_call_gap_ms: null };
  const ordered = [...timed].sort((left, right) => left.timing.started_at.localeCompare(right.timing.started_at));
  const started = Math.min(...ordered.map((entry) => Date.parse(entry.timing.started_at)));
  const completed = Math.max(...ordered.map((entry) => Date.parse(entry.timing.completed_at)));
  const firstBytes = ordered.map((entry) => entry.timing.time_to_first_byte_ms).filter((value): value is number => value !== null);
  let gaps = 0;
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    gaps += Math.max(0, Date.parse(current.timing.started_at) - Date.parse(previous.timing.completed_at));
  }
  return {
    trace_span_ms: Number.isFinite(started) && Number.isFinite(completed) ? Math.max(0, completed - started) : null,
    model_duration_ms: ordered.reduce((sum, entry) => sum + entry.timing.duration_ms, 0),
    average_time_to_first_byte_ms: firstBytes.length ? firstBytes.reduce((sum, value) => sum + value, 0) / firstBytes.length : null,
    inter_call_gap_ms: ordered.length > 1 ? gaps : 0,
  };
}

function runStatus(entries: readonly CaptureIndexEntry[]): InsightRunSummary['status'] {
  const known = entries.map((entry) => entry.response_status).filter((value): value is number => typeof value === 'number');
  if (!known.length) return 'unknown';
  return known.every((status) => status >= 200 && status < 300) ? 'ok' : 'error';
}

function summary(entries: CaptureIndexEntry[], source: 'explicit' | 'inferred', truncated: boolean): InsightRunSummary {
  const ordered = [...entries].sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
  const first = ordered[0]!;
  const last = ordered.at(-1)!;
  return {
    run_id: last.id,
    trace_id: first.trace_id ?? null,
    source,
    truncated,
    started_at: first.timing?.started_at ?? first.timestamp,
    completed_at: last.timing?.completed_at ?? last.timestamp,
    calls: ordered.length,
    models: unique(ordered.map((entry) => entry.model)),
    upstream_hosts: unique(ordered.map((entry) => entry.upstream_host)),
    response_statuses: [...new Set(ordered.map((entry) => entry.response_status).filter((value): value is number => typeof value === 'number'))].sort((a, b) => a - b),
    status: runStatus(ordered),
    tokens: aggregateTokens(ordered),
    timing: timingMetrics(ordered),
  };
}

export function listInsightRuns(captures: readonly CaptureIndexEntry[], getParentId: ParentLookup, limit = DEFAULT_LIMIT): InsightRunSummary[] {
  const runs: InsightRunSummary[] = [];
  const explicit = new Map<string, CaptureIndexEntry[]>();
  const untraced = captures.filter((entry) => !entry.trace_id);
  for (const entry of captures) {
    if (!entry.trace_id) continue;
    const group = explicit.get(entry.trace_id) ?? [];
    group.push(entry);
    explicit.set(entry.trace_id, group);
  }
  for (const entries of explicit.values()) runs.push(summary(entries, 'explicit', false));

  const parentIds = new Set(untraced.map((entry) => getParentId(entry.id)).filter((id): id is string => Boolean(id)));
  const leaves = untraced.filter((entry) => !parentIds.has(entry.id));
  for (const leaf of leaves) {
    const byId = new Map(captures.map((item) => [item.id, item]));
    const entries: CaptureIndexEntry[] = []; let current: CaptureIndexEntry | undefined = leaf; const seen = new Set<string>(); let truncated = false;
    while (current && !seen.has(current.id)) { entries.push(current); seen.add(current.id); const parent = getParentId(current.id); if (!parent) break; current = byId.get(parent); if (!current) truncated = true; }
    runs.push(summary(entries.reverse(), 'inferred', truncated));
  }
  return runs.sort((left, right) => right.completed_at.localeCompare(left.completed_at) || right.run_id.localeCompare(left.run_id)).slice(0, limit);
}

function entriesForTrace(trace: TraceResult, captures: readonly CaptureIndexEntry[]): CaptureIndexEntry[] {
  const byId = new Map(captures.map((entry) => [entry.id, entry]));
  return trace.calls.map((call) => byId.get(call.capture_id)).filter((entry): entry is CaptureIndexEntry => Boolean(entry));
}

function sectionSize(section: ModelInputSection): Omit<InsightSectionMetrics, 'changes'> {
  const serialized = canonical(section.value);
  return { id: section.id, label: section.label, chars: serialized.length, bytes: Buffer.byteLength(serialized), fingerprint: fingerprint(section.value) };
}

function resultBlocks(messages: Array<{ content: ConversationContentBlock[] }>) {
  return messages.flatMap((message) => message.content.filter((block) => block.type === 'tool_result'));
}

function finding(code: string, scope: string, severity: InsightFinding['severity'], summaryText: string, recommendation: string, evidence: InsightEvidenceLocation[]): InsightFinding {
  return { code, scope, severity, summary: summaryText, recommendation, evidence };
}

export async function buildInsightReport(selectedId: string, context: ServerPluginContext, getParentId: ParentLookup): Promise<InsightReport | null> {
  const trace = await context.getTraceResult?.(selectedId) ?? await localTraceResult(selectedId, context, getParentId);
  if (!trace) return null;
  const entries = entriesForTrace(trace, context.captures);
  if (!entries.length) return null;
  const run = summary(entries, trace.source, trace.truncated);
  const sectionHistory = new Map<string, Array<{ captureId: string; metric: Omit<InsightSectionMetrics, 'changes'> }>>();
  const toolNames = new Map<string, InsightToolNameMetrics>();
  const toolCallNames = new Map<string, string>();
  const signatures = new Map<string, { name: string; count: number; captureIds: string[] }>();
  const findings: InsightFinding[] = [];
  const calls: InsightCallMetrics[] = [];

  for (const call of trace.calls) {
    const entry = entries.find((candidate) => candidate.id === call.capture_id)!;
    const capture = await context.readCapture(call.capture_id);
    let promptInput = entry.prompt_input ?? capture?.prompt_input;
    if (!promptInput && capture?.request?.body) {
      try { promptInput = context.parseProviderRequest(capture.adapter_id ?? 'anthropic', capture.request.body).input; }
      catch { promptInput = undefined; }
    }
    const sections = (promptInput?.sections ?? []).map(sectionSize);
    for (const metric of sections) {
      const history = sectionHistory.get(metric.id) ?? [];
      history.push({ captureId: entry.id, metric });
      sectionHistory.set(metric.id, history);
    }
    const outputCalls = call.output?.content.filter((block) => block.type === 'tool_call') ?? [];
    const results = resultBlocks(call.input_delta);
    for (const block of outputCalls) {
      const perTool = toolNames.get(block.name) ?? { name: block.name, calls: 0, errors: 0, invalid_arguments: 0, repeated_calls: 0, result_bytes: 0 };
      perTool.calls++;
      if (block.input_raw !== undefined) perTool.invalid_arguments++;
      toolNames.set(block.name, perTool);
      if (block.id) toolCallNames.set(block.id, block.name);
      const signature = `${block.name}:${fingerprint(block.input_raw ?? block.input)}`;
      const repeated = signatures.get(signature) ?? { name: block.name, count: 0, captureIds: [] };
      repeated.count++;
      repeated.captureIds.push(call.capture_id);
      signatures.set(signature, repeated);
      if (block.input_raw !== undefined) findings.push(finding(
        'invalid_tool_arguments', block.name, 'error',
        `Tool ${block.name} received invalid JSON arguments.`,
        'Fix the tool schema or prompt so the model emits valid JSON arguments.',
        [{ capture_id: call.capture_id, section: 'tool-events', tool: block.name }],
      ));
    }
    let resultBytes = 0;
    let resultErrors = 0;
    for (const block of results) {
      const bytes = Buffer.byteLength(canonical(block.content));
      resultBytes += bytes;
      if (block.is_error) resultErrors++;
      const matchingName = block.tool_call_id ? toolCallNames.get(block.tool_call_id) : undefined;
      if (matchingName) {
        const perTool = toolNames.get(matchingName) ?? { name: matchingName, calls: 0, errors: 0, invalid_arguments: 0, repeated_calls: 0, result_bytes: 0 };
        perTool.result_bytes += bytes;
        if (block.is_error) perTool.errors++;
        toolNames.set(matchingName, perTool);
      }
      if (block.is_error) findings.push(finding(
        'tool_error', matchingName ?? 'unknown-tool', 'warning',
        'A tool result was returned as an error.',
        'Inspect the tool implementation and arguments before adding more retry instructions.',
        [{ capture_id: call.capture_id, section: 'tool-events', value: block.tool_call_id }],
      ));
      if (bytes >= LARGE_TOOL_RESULT_BYTES) findings.push(finding(
        'large_tool_result', matchingName ?? 'unknown-tool', 'warning',
        `A tool result added ${bytes} bytes to model context.`,
        'Return a smaller structured result, paginate it, or summarize it before the next model call.',
        [{ capture_id: call.capture_id, section: 'tool-events', metric: 'result_bytes', value: bytes, threshold: LARGE_TOOL_RESULT_BYTES }],
      ));
    }
    if (call.input_relation === 'rewritten') findings.push(finding(
      'rewritten_history', 'messages', 'warning',
      'Conversation history was rewritten instead of appended.',
      'Keep stable history prefixes when possible so providers can reuse cached input.',
      [{ capture_id: call.capture_id, section: 'messages' }],
    ));
    if (typeof call.response_status === 'number' && (call.response_status < 200 || call.response_status >= 300)) findings.push(finding(
      'request_error', `http-${call.response_status}`, 'error', `Model request returned HTTP ${call.response_status}.`,
      'Resolve the provider or request failure before evaluating prompt efficiency.',
      [{ capture_id: call.capture_id, metric: 'response_status', value: call.response_status }],
    ));
    if (call.output?.error) findings.push(finding(
      'provider_error', call.output.error.type ?? 'unknown', 'error', `Provider error: ${call.output.error.message}`,
      'Resolve the provider error before evaluating prompt efficiency.',
      [{ capture_id: call.capture_id, section: 'output', value: call.output.error.type }],
    ));
    const outputBlocks: Record<string, number> = {};
    for (const block of call.output?.content ?? []) outputBlocks[block.type] = (outputBlocks[block.type] ?? 0) + 1;
    calls.push({
      capture_id: call.capture_id,
      timestamp: call.timestamp,
      model: call.model,
      upstream_host: call.upstream_host,
      response_status: call.response_status,
      input_relation: call.input_relation,
      usage: entry.usage,
      timing: entry.timing ?? null,
      sections,
      tool_calls: outputCalls.length,
      tool_results: results.length,
      tool_errors: resultErrors,
      tool_result_bytes: resultBytes,
      output_blocks: outputBlocks,
      stop_reason: call.output?.stop_reason ?? null,
    });
  }

  for (const [signature, repeated] of signatures) {
    if (repeated.count < 2) continue;
    const perTool = toolNames.get(repeated.name)!;
    perTool.repeated_calls += repeated.count - 1;
    findings.push(finding(
      'repeated_tool_call', signature, 'warning',
      `Tool ${repeated.name} was called ${repeated.count} times with identical arguments.`,
      'Reuse the first result or make the agent avoid rereading unchanged data.',
      repeated.captureIds.map((captureId) => ({ capture_id: captureId, section: 'tool-events', tool: repeated.name })),
    ));
  }

  const sections: InsightSectionMetrics[] = [];
  for (const [id, history] of sectionHistory) {
    let changes = 0;
    for (let index = 1; index < history.length; index++) if (history[index]!.metric.fingerprint !== history[index - 1]!.metric.fingerprint) changes++;
    const latest = history.at(-1)!.metric;
    sections.push({ ...latest, changes });
    if ((id === 'system' || id === 'tools') && changes > 0) findings.push(finding(
      'static_input_changed', id, 'warning',
      `${latest.label} changed ${changes} time${changes === 1 ? '' : 's'} during the run.`,
      `Keep the ${latest.label.toLowerCase()} section stable across model calls when possible.`,
      history.slice(1).filter((item, index) => item.metric.fingerprint !== history[index]!.metric.fingerprint)
        .map((item) => ({ capture_id: item.captureId, section: id })),
    ));
  }
  sections.sort((left, right) => left.id.localeCompare(right.id));

  const laterEntries = entries.slice(1);
  const laterTokens = aggregateTokens(laterEntries);
  const cacheSupported = laterEntries.some(({ usage }) => 'cache_read_input_tokens' in usage || 'cache_creation_input_tokens' in usage);
  if (cacheSupported && laterTokens.input_total_tokens >= LOW_CACHE_MIN_TOKENS && (laterTokens.cache_hit_rate ?? 0) < LOW_CACHE_RATE) findings.push(finding(
    'low_cache_reuse', 'trace', 'warning',
    `Non-initial calls reused ${Math.round((laterTokens.cache_hit_rate ?? 0) * 100)}% of input tokens from cache.`,
    'Stabilize the leading system, tool, and conversation sections and move volatile content later.',
    [{ capture_id: run.run_id, metric: 'cache_hit_rate', value: laterTokens.cache_hit_rate, threshold: LOW_CACHE_RATE }],
  ));

  const byName = [...toolNames.values()].sort((left, right) => left.name.localeCompare(right.name));
  const tools: InsightToolMetrics = {
    calls: byName.reduce((sum, item) => sum + item.calls, 0),
    errors: calls.reduce((sum, item) => sum + item.tool_errors, 0),
    invalid_arguments: byName.reduce((sum, item) => sum + item.invalid_arguments, 0),
    repeated_calls: byName.reduce((sum, item) => sum + item.repeated_calls, 0),
    result_bytes: calls.reduce((sum, item) => sum + item.tool_result_bytes, 0),
    by_name: byName,
  };
  findings.sort((left, right) => left.code.localeCompare(right.code) || left.scope.localeCompare(right.scope));
  return { schema_version: SCHEMA_VERSION, run, sections, tools, calls, findings };
}

async function localTraceResult(selectedId: string, context: ServerPluginContext, getParentId: ParentLookup): Promise<TraceResult | null> {
  const selected = context.captures.find((item) => item.id === selectedId);
  if (!selected || !(await context.readCapture(selectedId))) return null;
  const source = selected.trace_id ? 'explicit' as const : 'inferred' as const;
  const byId = new Map(context.captures.map((item) => [item.id, item]));
  let entries: CaptureIndexEntry[];
  let truncated = false;
  if (source === 'explicit') entries = context.captures.filter((item) => item.trace_id === selected.trace_id);
  else {
    entries = []; const seen = new Set<string>(); let current: CaptureIndexEntry | undefined = selected;
    while (current && !seen.has(current.id)) { entries.push(current); seen.add(current.id); const parent = getParentId(current.id); if (!parent) break; current = byId.get(parent); if (!current) truncated = true; }
    entries.reverse();
  }
  entries.sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
  let previous = null as import('@prompt-prism/contracts/model').ConversationMessage[] | null;
  const calls: TraceResult['calls'] = [];
  for (const entry of entries) {
    const capture = await context.readCapture(entry.id);
    const conversation = capture?.prompt_input?.conversation ?? (capture ? parseConversation(capture, context) : []);
    const output = capture?.model_output ?? (capture ? parseOutput(capture, context) : null);
    const prefix = previous && previous.length <= conversation.length && previous.every((message, index) => JSON.stringify(message) === JSON.stringify(conversation[index]));
    calls.push({ capture_id: entry.id, timestamp: entry.timestamp, model: entry.model, response_status: entry.response_status, upstream_host: entry.upstream_host, input_relation: previous === null ? 'root' : prefix ? 'append' : 'rewritten', input_delta: previous && prefix ? conversation.slice(previous.length) : conversation, output });
    previous = conversation;
  }
  return { id: selected.trace_id ?? entries[0]?.id ?? selected.id, source, selected_capture_id: selected.id, truncated, calls };
}

function delta(before: number | null, after: number | null): InsightMetricDelta {
  if (before === null || after === null) return { before, after, absolute: null, percent: null };
  const absolute = after - before;
  return { before, after, absolute, percent: before === 0 ? null : absolute / Math.abs(before) };
}

function findingKey(item: InsightFinding): string { return `${item.code}:${item.scope}`; }

export function compareInsightReports(baseline: InsightReport, candidate: InsightReport): InsightComparison {
  const baselineFindings = new Map(baseline.findings.map((item) => [findingKey(item), item]));
  const candidateFindings = new Map(candidate.findings.map((item) => [findingKey(item), item]));
  const toolNames = unique([...baseline.tools.by_name.map((item) => item.name), ...candidate.tools.by_name.map((item) => item.name)]);
  const metricValues: Array<[string, number | null, number | null]> = [
    ['calls', baseline.run.calls, candidate.run.calls],
    ['uncached_input_tokens', baseline.run.tokens.uncached_input_tokens, candidate.run.tokens.uncached_input_tokens],
    ['output_tokens', baseline.run.tokens.output_tokens, candidate.run.tokens.output_tokens],
    ['cache_read_input_tokens', baseline.run.tokens.cache_read_input_tokens, candidate.run.tokens.cache_read_input_tokens],
    ['cache_write_input_tokens', baseline.run.tokens.cache_write_input_tokens, candidate.run.tokens.cache_write_input_tokens],
    ['input_total_tokens', baseline.run.tokens.input_total_tokens, candidate.run.tokens.input_total_tokens],
    ['cache_hit_rate', baseline.run.tokens.cache_hit_rate, candidate.run.tokens.cache_hit_rate],
    ['trace_span_ms', baseline.run.timing.trace_span_ms, candidate.run.timing.trace_span_ms],
    ['model_duration_ms', baseline.run.timing.model_duration_ms, candidate.run.timing.model_duration_ms],
    ['average_time_to_first_byte_ms', baseline.run.timing.average_time_to_first_byte_ms, candidate.run.timing.average_time_to_first_byte_ms],
    ['inter_call_gap_ms', baseline.run.timing.inter_call_gap_ms, candidate.run.timing.inter_call_gap_ms],
    ['tool_calls', baseline.tools.calls, candidate.tools.calls],
    ['tool_errors', baseline.tools.errors, candidate.tools.errors],
    ['repeated_tool_calls', baseline.tools.repeated_calls, candidate.tools.repeated_calls],
    ['tool_result_bytes', baseline.tools.result_bytes, candidate.tools.result_bytes],
  ];
  return {
    schema_version: SCHEMA_VERSION,
    baseline: baseline.run,
    candidate: candidate.run,
    metrics: Object.fromEntries(metricValues.map(([key, before, after]) => [key, delta(before, after)])),
    tools_by_name: toolNames.map((name) => {
      const before = baseline.tools.by_name.find((item) => item.name === name);
      const after = candidate.tools.by_name.find((item) => item.name === name);
      return {
        name,
        calls: delta(before?.calls ?? 0, after?.calls ?? 0),
        errors: delta(before?.errors ?? 0, after?.errors ?? 0),
        repeated_calls: delta(before?.repeated_calls ?? 0, after?.repeated_calls ?? 0),
        result_bytes: delta(before?.result_bytes ?? 0, after?.result_bytes ?? 0),
      };
    }),
    findings: {
      added: [...candidateFindings].filter(([key]) => !baselineFindings.has(key)).map(([, item]) => item),
      resolved: [...baselineFindings].filter(([key]) => !candidateFindings.has(key)).map(([, item]) => item),
      persisting: [...candidateFindings].filter(([key]) => baselineFindings.has(key)).map(([, item]) => item),
    },
  };
}

function contentType(headers: Record<string, string | string[] | undefined> | undefined): string | undefined {
  const value = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
  return Array.isArray(value) ? value[0] : value;
}

function utf8Prefix(buffer: Buffer, maximum: number): string {
  let end = Math.min(buffer.length, maximum);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  while (end > 0) {
    try { return decoder.decode(buffer.subarray(0, end)); }
    catch { end--; }
  }
  return '';
}

export async function buildInsightEvidence(captureId: string, sectionId: string, maxBytes: number, context: ServerPluginContext): Promise<InsightEvidence | null> {
  const capture = await context.readCapture(captureId);
  if (!capture) return null;
  let value: unknown;
  if (sectionId === 'output') value = capture.model_output ?? parseOutput(capture, context);
  else if (sectionId === 'tool-events') {
    const conversation = capture.prompt_input?.conversation ?? parseConversation(capture, context);
    const output = capture.model_output ?? parseOutput(capture, context);
    value = {
      input: conversation.flatMap((message) => message.content.filter((block) => block.type === 'tool_call' || block.type === 'tool_result')),
      output: output?.content.filter((block) => block.type === 'tool_call') ?? [],
    };
  } else {
    let input = capture.prompt_input;
    if (!input && capture.request?.body) {
      try { input = context.parseProviderRequest(capture.adapter_id ?? 'anthropic', capture.request.body).input; }
      catch { input = undefined; }
    }
    const section = input?.sections.find((item) => item.id === sectionId);
    if (!section) return null;
    value = section.value;
  }
  const serialized = JSON.stringify(value ?? null, null, 2);
  const bytes = Buffer.from(serialized);
  const content = utf8Prefix(bytes, maxBytes);
  return {
    schema_version: SCHEMA_VERSION,
    capture_id: captureId,
    section: sectionId,
    encoding: 'json',
    content,
    original_bytes: bytes.length,
    returned_bytes: Buffer.byteLength(content),
    truncated: bytes.length > maxBytes,
  };
}

function positiveInteger(value: string | null, fallback: number, maximum: number): number | null {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : null;
}

export function createInsightsServerPlugin(): PromptPrismServerPlugin {
  return {
    id: insightsPluginMeta.id,
    async handleApi(request, response, subpath, context) {
      if (request.method !== 'GET') {
        context.json(response, 405, { error: 'Method not allowed', code: 'method_not_allowed' });
        return true;
      }
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (subpath === 'runs') {
        const limit = positiveInteger(url.searchParams.get('limit'), DEFAULT_LIMIT, MAX_LIMIT);
        if (limit === null) context.json(response, 400, { error: `limit must be between 1 and ${MAX_LIMIT}`, code: 'invalid_argument' });
        else context.json(response, 200, { schema_version: SCHEMA_VERSION, runs: listInsightRuns(context.captures, context.getTraceParent ?? (() => null), limit) });
        return true;
      }
      if (subpath.startsWith('report/')) {
        const report = await buildInsightReport(decodeURIComponent(subpath.slice('report/'.length)), context, context.getTraceParent ?? (() => null));
        if (!report) context.json(response, 404, { error: 'Run not found', code: 'run_not_found' });
        else context.json(response, 200, report);
        return true;
      }
      if (subpath === 'compare') {
        const baselineId = url.searchParams.get('baseline');
        const candidateId = url.searchParams.get('candidate');
        if (!baselineId || !candidateId) {
          context.json(response, 400, { error: 'baseline and candidate are required', code: 'invalid_argument' });
          return true;
        }
        const [baseline, candidate] = await Promise.all([
          buildInsightReport(baselineId, context, context.getTraceParent ?? (() => null)),
          buildInsightReport(candidateId, context, context.getTraceParent ?? (() => null)),
        ]);
        if (!baseline || !candidate) context.json(response, 404, { error: 'Run not found', code: 'run_not_found' });
        else context.json(response, 200, compareInsightReports(baseline, candidate));
        return true;
      }
      if (subpath.startsWith('evidence/')) {
        const section = url.searchParams.get('section');
        const maxBytes = positiveInteger(url.searchParams.get('max_bytes'), DEFAULT_EVIDENCE_BYTES, MAX_EVIDENCE_BYTES);
        if (!section || maxBytes === null) {
          context.json(response, 400, { error: `section is required and max_bytes must be between 1 and ${MAX_EVIDENCE_BYTES}`, code: 'invalid_argument' });
          return true;
        }
        const evidence = await buildInsightEvidence(decodeURIComponent(subpath.slice('evidence/'.length)), section, maxBytes, context);
        if (!evidence) context.json(response, 404, { error: 'Capture or evidence section not found', code: 'evidence_not_found' });
        else context.json(response, 200, evidence);
        return true;
      }
      context.json(response, 404, { error: 'Not found', code: 'not_found' });
      return true;
    },
  };
}
