import { describe, expect, it, vi } from 'vitest';
import type { Capture, JsonValue, ModelInputSnapshot, ModelOutputSnapshot, ServerPluginContext } from '../../contracts/server.js';
import { createToolsServerPlugin } from '../server/index.js';

const response = {} as never;
const request = (method = 'GET') => ({ method }) as never;

function input(tools: JsonValue[]): ModelInputSnapshot {
  return {
    adapter_id: 'anthropic-messages',
    primary_section_id: 'messages',
    sections: [
      { id: 'messages', label: 'Messages', order: 10, value: [], compare_as: 'sequence', default_collapsed: false },
      { id: 'tools', label: 'Tools', order: 30, value: tools, compare_as: 'json', default_collapsed: true },
    ],
  };
}

function capture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: 'abc', timestamp: '2026-08-09T00:00:00.000Z', token_hash: 'hash', model: 'model', messages: [], usage: {}, ...overrides,
  };
}

function context(value: Capture | null, parsedInput = input([]), parsedOutput: ModelOutputSnapshot | null = null): ServerPluginContext {
  return {
    analysisPath: '/tmp/analysis.jsonl', captures: [],
    readCapture: vi.fn().mockResolvedValue(value),
    parseProviderRequest: vi.fn().mockReturnValue({ model: null, messages: [], input: parsedInput }),
    parseProviderResponse: vi.fn().mockReturnValue({ usage: {}, output: parsedOutput }), json: vi.fn(), reportError: vi.fn(),
  };
}

describe('Tools server plugin', () => {
  it('returns normalized tools from prompt_input', async () => {
    const tools = [{ name: 'read', description: 'Read a file', input_schema: { type: 'object' } }] as JsonValue[];
    const pluginContext = context(capture({ prompt_input: input(tools) }));

    await createToolsServerPlugin().handleApi!(request(), response, 'abc', pluginContext);

    expect(pluginContext.json).toHaveBeenCalledWith(response, 200, { id: 'abc', tools, used_tools: [] });
    expect(pluginContext.parseProviderRequest).not.toHaveBeenCalled();
  });

  it('falls back to parsing the raw request for historical captures', async () => {
    const tools = [{ type: 'function', function: { name: 'bash', parameters: { type: 'object' } } }] as JsonValue[];
    const pluginContext = context(capture({ adapter_id: 'openai-chat-completions', request: { method: 'POST', url: '/v1/chat/completions', headers: {}, body: '{}' } }), input(tools));

    await createToolsServerPlugin().handleApi!(request(), response, 'abc', pluginContext);

    expect(pluginContext.parseProviderRequest).toHaveBeenCalledWith('openai-chat-completions', '{}');
    expect(pluginContext.json).toHaveBeenCalledWith(response, 200, { id: 'abc', tools, used_tools: [] });
  });

  it('counts tool calls from the current capture output', async () => {
    const tools = [{ name: 'read' }] as JsonValue[];
    const output: ModelOutputSnapshot = {
      adapter_id: 'anthropic-messages', id: 'message', model: 'model', role: 'assistant', stop_reason: 'tool_use', usage: {},
      content: [
        { type: 'tool_call', id: 'one', name: 'read', input: { path: 'a.ts' } },
        { type: 'tool_call', id: 'two', name: 'read', input: { path: 'b.ts' } },
        { type: 'tool_call', id: 'three', name: 'bash', input: {} },
      ],
    };
    const pluginContext = context(capture({ prompt_input: input(tools), model_output: output }));

    await createToolsServerPlugin().handleApi!(request(), response, 'abc', pluginContext);

    expect(pluginContext.json).toHaveBeenCalledWith(response, 200, { id: 'abc', tools, used_tools: [
      { name: 'read', calls: 2, invocations: [{ tool_call_id: 'one', index: 0, input: { path: 'a.ts' } }, { tool_call_id: 'two', index: 1, input: { path: 'b.ts' } }] },
      { name: 'bash', calls: 1, invocations: [{ tool_call_id: 'three', index: 2, input: {} }] },
    ] });
  });

  it('parses tool calls from a historical raw response', async () => {
    const output: ModelOutputSnapshot = {
      adapter_id: 'openai-chat-completions', id: 'message', model: 'model', role: 'assistant', stop_reason: 'tool_calls', usage: {},
      content: [{ type: 'tool_call', id: 'one', name: 'bash', input: {} }],
    };
    const pluginContext = context(capture({ request: { method: 'POST', url: '/v1/chat/completions', headers: { 'content-type': 'application/json' }, body: '{}' }, response: { status: 200, headers: { 'content-type': 'application/json' }, body: '{}' } }), input([]), output);

    await createToolsServerPlugin().handleApi!(request(), response, 'abc', pluginContext);

    expect(pluginContext.json).toHaveBeenCalledWith(response, 200, { id: 'abc', tools: [], used_tools: [{ name: 'bash', calls: 1, invocations: [{ tool_call_id: 'one', index: 0, input: {} }] }] });
  });

  it('returns an empty list when no tools are present', async () => {
    const pluginContext = context(capture({ prompt_input: input([]) }));

    await createToolsServerPlugin().handleApi!(request(), response, 'abc', pluginContext);

    expect(pluginContext.json).toHaveBeenCalledWith(response, 200, { id: 'abc', tools: [], used_tools: [] });
  });

  it('handles missing captures and unsupported methods', async () => {
    const missing = context(null);
    await createToolsServerPlugin().handleApi!(request(), response, 'missing', missing);
    expect(missing.json).toHaveBeenCalledWith(response, 404, { error: 'Capture not found' });

    const method = context(null);
    await createToolsServerPlugin().handleApi!(request('POST'), response, 'abc', method);
    expect(method.json).toHaveBeenCalledWith(response, 405, { error: 'Method not allowed' });
    expect(method.readCapture).not.toHaveBeenCalled();
  });
});
