import { describe, expect, it, vi } from 'vitest';
import type { Capture, CaptureIndexEntry, JsonValue, ModelInputSnapshot, ModelOutputSnapshot, ServerPluginContext } from '../../contracts/server.js';
import {
  buildInsightEvidence,
  buildInsightReport,
  compareInsightReports,
  createInsightsServerPlugin,
  listInsightRuns,
} from '../server/index.js';

const timing = (start: string, duration: number, firstByte: number) => ({
  started_at: start,
  completed_at: new Date(Date.parse(start) + duration).toISOString(),
  duration_ms: duration,
  time_to_headers_ms: Math.max(0, firstByte - 5),
  time_to_first_byte_ms: firstByte,
});

const validTool = { type: 'tool_call' as const, id: 'tool-1', name: 'read', input: { path: 'a.ts' } };
const invalidTool = { type: 'tool_call' as const, id: 'tool-bad', name: 'bash', input: null, input_raw: '{' };
const firstOutput: ModelOutputSnapshot = {
  adapter_id: 'anthropic', id: 'one', model: 'model', role: 'assistant', stop_reason: 'tool_use', usage: {}, content: [validTool, invalidTool],
};
const secondOutput: ModelOutputSnapshot = {
  adapter_id: 'anthropic', id: 'two', model: 'model', role: 'assistant', stop_reason: 'tool_use', usage: {}, content: [{ ...validTool, id: 'tool-2' }],
};

function input(system: string, conversation: ModelInputSnapshot['conversation']) {
  return {
    adapter_id: 'anthropic', primary_section_id: 'messages', primary_sequence: [], conversation,
    sections: [
      { id: 'messages', label: 'Messages', order: 10, value: (conversation ?? []) as unknown as JsonValue, compare_as: 'sequence' as const, default_collapsed: false },
      { id: 'system', label: 'System', order: 20, value: system, compare_as: 'json' as const, default_collapsed: false },
      { id: 'tools', label: 'Tools', order: 30, value: [{ name: 'read' }], compare_as: 'json' as const, default_collapsed: true },
    ],
  };
}

function entry(id: string, timestamp: string, traceId: string, system: string, usage: CaptureIndexEntry['usage'], captureTiming: CaptureIndexEntry['timing']): CaptureIndexEntry {
  return {
    id, timestamp, token_hash: 'token', trace_id: traceId, adapter_id: 'anthropic', upstream_host: 'api.example.com',
    model: 'model', usage, timing: captureTiming, response_status: 200, file_ref: `${id}.json`, messages: [],
    prompt_input: input(system, []),
  };
}

function context(entries: CaptureIndexEntry[], captures: Capture[]): ServerPluginContext {
  const byId = new Map(captures.map((capture) => [capture.id, capture]));
  return {
    analysisPath: '/tmp/analysis.jsonl', captures: entries,
    readCapture: vi.fn(async (id) => byId.get(id) ?? null),
    parseProviderRequest: vi.fn(), parseProviderResponse: vi.fn(), json: vi.fn(), reportError: vi.fn(),
  };
}

function fixture() {
  const first = entry('first', '2026-08-09T00:00:00.100Z', 'trace-one', 'SECRET_SYSTEM_BEFORE', { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 100 }, timing('2026-08-09T00:00:00.000Z', 100, 30));
  const second = entry('second', '2026-08-09T00:00:02.200Z', 'trace-one', 'SECRET_SYSTEM_AFTER', { input_tokens: 1000, output_tokens: 20, cache_read_input_tokens: 10, cache_creation_input_tokens: 20 }, timing('2026-08-09T00:00:02.000Z', 200, 50));
  const assistant = { role: 'assistant', content: [validTool, { type: 'tool_call' as const, id: 'tool-bad', name: 'bash', input: null }] };
  const result = { role: 'user', content: [{ type: 'tool_result' as const, tool_call_id: 'tool-1', content: `你${'x'.repeat(17 * 1024)}`, is_error: true }] };
  const firstCapture: Capture = { ...first, prompt_input: input('SECRET_SYSTEM_BEFORE', [{ role: 'user', content: [{ type: 'text', text: 'fix' }] }]), model_output: firstOutput };
  const secondCapture: Capture = { ...second, prompt_input: input('SECRET_SYSTEM_AFTER', [{ role: 'user', content: [{ type: 'text', text: 'fix' }] }, assistant, result]), model_output: secondOutput };
  first.prompt_input = firstCapture.prompt_input;
  second.prompt_input = secondCapture.prompt_input;
  return { first, second, pluginContext: context([second, first], [firstCapture, secondCapture]) };
}

describe('Insights server plugin', () => {
  it('lists stable run anchors and builds actionable statistics without raw content', async () => {
    const { second, pluginContext } = fixture();
    second.token_hash = 'other-token';
    second.adapter_id = 'openai-chat-completions';
    second.upstream_host = 'other.example.com';
    const runs = listInsightRuns(pluginContext.captures, () => null);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ run_id: second.id, trace_id: 'trace-one', calls: 2, status: 'ok' });
    expect(runs[0]?.timing).toMatchObject({ trace_span_ms: 2200, model_duration_ms: 300, inter_call_gap_ms: 1900 });

    const report = await buildInsightReport(second.id, pluginContext, () => null);
    expect(report?.run).toEqual(runs[0]);
    expect(report?.tools).toMatchObject({ calls: 3, errors: 1, invalid_arguments: 1, repeated_calls: 1 });
    expect(report?.sections.find((section) => section.id === 'system')?.changes).toBe(1);
    expect(report?.findings.map((item) => item.code)).toEqual(expect.arrayContaining([
      'invalid_tool_arguments', 'large_tool_result', 'low_cache_reuse', 'repeated_tool_call', 'static_input_changed', 'tool_error',
    ]));
    expect(JSON.stringify(report)).not.toContain('SECRET_SYSTEM');
    expect(JSON.stringify(report)).not.toContain('a.ts');
    expect(JSON.stringify(report)).not.toContain('x'.repeat(100));
  });

  it('lists inferred leaf runs separately and marks missing ancestors as truncated', () => {
    const first = { ...entry('root', '2026-08-09T00:00:00.000Z', '', 'one', {}, undefined), trace_id: undefined };
    const left = { ...entry('left', '2026-08-09T00:00:01.000Z', '', 'one', {}, undefined), trace_id: undefined };
    const right = { ...entry('right', '2026-08-09T00:00:02.000Z', '', 'one', {}, undefined), trace_id: undefined };
    const parents = new Map<string, string>([['left', 'root'], ['right', 'root'], ['root', 'evicted']]);
    const runs = listInsightRuns([first, left, right], (id) => parents.get(id));
    expect(runs.map((run) => run.run_id)).toEqual(['right', 'left']);
    expect(runs.every((run) => run.source === 'inferred' && run.truncated)).toBe(true);
    expect(runs.every((run) => run.timing.trace_span_ms === null)).toBe(true);
  });

  it('compares metrics and classifies added, resolved, and persisting findings', async () => {
    const { second, pluginContext } = fixture();
    const baseline = await buildInsightReport(second.id, pluginContext, () => null);
    expect(baseline).not.toBeNull();
    const candidate = structuredClone(baseline!);
    candidate.run.run_id = 'candidate';
    candidate.run.calls = 1;
    candidate.tools.calls = 1;
    candidate.findings = [baseline!.findings[0]!, { ...baseline!.findings[0]!, code: 'new_issue', scope: 'candidate' }];
    const comparison = compareInsightReports(baseline!, candidate);
    expect(comparison.metrics.calls).toMatchObject({ before: 2, after: 1, absolute: -1, percent: -0.5 });
    expect(comparison.findings.added.map((item) => item.code)).toContain('new_issue');
    expect(comparison.findings.resolved.length).toBeGreaterThan(0);
    expect(comparison.findings.persisting).toHaveLength(1);
  });

  it('returns explicit, size-limited evidence and preserves UTF-8 boundaries', async () => {
    const { second, pluginContext } = fixture();
    const system = await buildInsightEvidence(second.id, 'system', 1024, pluginContext);
    expect(system).toMatchObject({ section: 'system', content: '"SECRET_SYSTEM_AFTER"', truncated: false });
    const tools = await buildInsightEvidence(second.id, 'tool-events', 101, pluginContext);
    expect(tools?.truncated).toBe(true);
    expect(Buffer.byteLength(tools?.content ?? '')).toBeLessThanOrEqual(101);
    expect(tools?.content).not.toContain('\uFFFD');
    expect(await buildInsightEvidence(second.id, 'missing', 100, pluginContext)).toBeNull();
  });

  it('validates API routes and returns reports', async () => {
    const { second, pluginContext } = fixture();
    const plugin = createInsightsServerPlugin({ getParentId: () => null });
    const response = {} as never;
    await plugin.handleApi!({ method: 'GET', url: '/_pp/api/insights/runs?limit=1' } as never, response, 'runs', pluginContext);
    await plugin.handleApi!({ method: 'GET', url: `/_pp/api/insights/report/${second.id}` } as never, response, `report/${second.id}`, pluginContext);
    expect(pluginContext.json).toHaveBeenNthCalledWith(1, response, 200, expect.objectContaining({ schema_version: 1 }));
    expect(pluginContext.json).toHaveBeenNthCalledWith(2, response, 200, expect.objectContaining({ schema_version: 1 }));
  });
});
