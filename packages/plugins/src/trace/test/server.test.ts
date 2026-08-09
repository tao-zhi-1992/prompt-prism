import { describe, expect, it, vi } from 'vitest';
import type { Capture, CaptureIndexEntry, ConversationMessage, ModelOutputSnapshot, ServerPluginContext } from '../../contracts/server.js';
import { createTraceServerPlugin } from '../server/index.js';

const request = (method = 'GET') => ({ method }) as never;
const response = {} as never;
const user = (text: string) => ({ role: 'user', content: [{ type: 'text' as const, text }] });
const toolCall = { role: 'assistant', content: [{ type: 'tool_call' as const, id: 'tool_1', name: 'read', input: { path: 'a.ts' } }] };
const toolResult = { role: 'user', content: [{ type: 'tool_result' as const, tool_call_id: 'tool_1', content: 'file', is_error: false }] };
const output: ModelOutputSnapshot = {
  adapter_id: 'anthropic', id: 'msg_1', model: 'model-a', role: 'assistant', stop_reason: 'tool_use', usage: {}, content: toolCall.content,
};

function entry(id: string, timestamp: string, traceId?: string): CaptureIndexEntry {
  return { id, timestamp, token_hash: 'token', trace_id: traceId, adapter_id: 'anthropic', upstream_host: 'api.example.com', model: 'model-a', usage: {}, file_ref: `${id}.json`, messages: [] };
}

function capture(value: CaptureIndexEntry, conversation: ConversationMessage[], modelOutput: ModelOutputSnapshot | undefined): Capture {
  return {
    ...value,
    prompt_input: { adapter_id: 'anthropic', primary_section_id: 'messages', sections: [], conversation },
    ...(modelOutput ? { model_output: modelOutput } : {}),
  };
}

function context(entries: CaptureIndexEntry[], captures: Capture[]): ServerPluginContext {
  const byId = new Map(captures.map((item) => [item.id, item]));
  return {
    analysisPath: '/tmp/analysis.jsonl', captures: entries,
    readCapture: vi.fn(async (id) => byId.get(id) ?? null),
    parseProviderRequest: vi.fn(), parseProviderResponse: vi.fn(), json: vi.fn(), reportError: vi.fn(),
  };
}

describe('Trace server plugin', () => {
  it('groups explicit traces and removes repeated assistant output from the next input delta', async () => {
    const first = entry('first', '2026-08-09T00:00:00.000Z', 'session-1');
    const second = entry('second', '2026-08-09T00:00:01.000Z', 'session-1');
    const unrelated = { ...entry('other', '2026-08-09T00:00:02.000Z', 'session-1'), token_hash: 'someone-else' };
    const pluginContext = context([second, unrelated, first], [
      capture(first, [user('fix it')], output),
      capture(second, [user('fix it'), toolCall, toolResult], undefined),
      capture(unrelated, [user('private')], undefined),
    ]);
    const plugin = createTraceServerPlugin({ getParentId: () => null });
    await plugin.handleApi!(request(), response, 'second', pluginContext);
    const result = vi.mocked(pluginContext.json).mock.calls[0]?.[2] as { source: string; calls: Array<{ capture_id: string; input_relation: string; input_delta: unknown[] }> };
    expect(result.source).toBe('explicit');
    expect(result.calls.map((call) => call.capture_id)).toEqual(['first', 'second']);
    expect(result.calls[1]?.input_relation).toBe('append');
    expect(result.calls[1]?.input_delta).toEqual([toolResult]);
  });

  it('follows only inferred parents and reports an evicted ancestor', async () => {
    const first = entry('first', '2026-08-09T00:00:00.000Z');
    const second = entry('second', '2026-08-09T00:00:01.000Z');
    const sibling = entry('sibling', '2026-08-09T00:00:02.000Z');
    const parents = new Map([['second', 'first'], ['first', 'evicted'], ['sibling', 'first']]);
    const pluginContext = context([first, second, sibling], [capture(first, [user('one')], undefined), capture(second, [user('one'), user('two')], undefined), capture(sibling, [user('other')], undefined)]);
    const plugin = createTraceServerPlugin({ getParentId: (id) => parents.get(id) });
    await plugin.handleApi!(request(), response, 'second', pluginContext);
    const result = vi.mocked(pluginContext.json).mock.calls[0]?.[2] as { source: string; truncated: boolean; calls: Array<{ capture_id: string }> };
    expect(result.source).toBe('inferred');
    expect(result.truncated).toBe(true);
    expect(result.calls.map((call) => call.capture_id)).toEqual(['first', 'second']);
  });

  it('returns method and capture errors', async () => {
    const pluginContext = context([], []);
    const plugin = createTraceServerPlugin({ getParentId: () => null });
    await plugin.handleApi!(request('POST'), response, 'missing', pluginContext);
    await plugin.handleApi!(request(), response, 'missing', pluginContext);
    expect(pluginContext.json).toHaveBeenNthCalledWith(1, response, 405, { error: 'Method not allowed' });
    expect(pluginContext.json).toHaveBeenNthCalledWith(2, response, 404, { error: 'Capture not found' });
  });
});
