import { describe, expect, it, vi } from 'vitest';
import { createSystemPromptServerPlugin } from '../server/index.js';
import type { ServerPluginContext } from '../../contracts/server.js';

const request = (method = 'GET') => ({ method }) as never;
const response = {} as never;

function context(capture: unknown): ServerPluginContext {
  return {
    analysisPath: '/tmp/analysis.jsonl',
    captures: [],
    readCapture: vi.fn().mockResolvedValue(capture),
    parseProviderRequest: vi.fn(),
    parseProviderResponse: vi.fn(),
    json: vi.fn(),
    reportError: vi.fn(),
  };
}

function captureWithSystem(system: unknown) {
  return {
    id: 'abc',
    messages: [],
    prompt_input: {
      adapter_id: 'anthropic-messages',
      primary_section_id: 'messages',
      sections: [
        { id: 'messages', label: 'Messages', order: 10, value: [], compare_as: 'sequence', default_collapsed: false },
        { id: 'system', label: 'System', order: 20, value: system, compare_as: 'json', default_collapsed: true },
      ],
    },
  };
}

describe('System Prompt server plugin', () => {
  it('returns the system section for a string system prompt', async () => {
    const pluginContext = context(captureWithSystem('You are a helpful assistant.'));
    const handled = await createSystemPromptServerPlugin().handleApi!(request(), response, 'capture%20id', pluginContext);
    expect(handled).toBe(true);
    expect(pluginContext.readCapture).toHaveBeenCalledWith('capture id');
    expect(pluginContext.json).toHaveBeenCalledWith(response, 200, { id: 'abc', system: 'You are a helpful assistant.' });
  });

  it('returns the system section for a content-block array', async () => {
    const blocks = [{ type: 'text', text: 'Be concise.' }];
    const pluginContext = context(captureWithSystem(blocks));
    await createSystemPromptServerPlugin().handleApi!(request(), response, 'abc', pluginContext);
    expect(pluginContext.json).toHaveBeenCalledWith(response, 200, { id: 'abc', system: blocks });
  });

  it('returns null for an empty system section', async () => {
    const pluginContext = context(captureWithSystem([]));
    await createSystemPromptServerPlugin().handleApi!(request(), response, 'abc', pluginContext);
    expect(pluginContext.json).toHaveBeenCalledWith(response, 200, { id: 'abc', system: null });
  });

  it('falls back to system/developer role messages for historical captures', async () => {
    const legacy = { id: 'old', messages: [{ role: 'system', content: 'Legacy system' }, { role: 'user', content: 'hi' }] };
    const pluginContext = context(legacy);
    await createSystemPromptServerPlugin().handleApi!(request(), response, 'old', pluginContext);
    expect(pluginContext.json).toHaveBeenCalledWith(response, 200, { id: 'old', system: [{ role: 'system', content: 'Legacy system' }] });
  });

  it('returns null when no system prompt is present', async () => {
    const none = { id: 'none', messages: [], prompt_input: { adapter_id: 'x', primary_section_id: 'messages', sections: [] } };
    const pluginContext = context(none);
    await createSystemPromptServerPlugin().handleApi!(request(), response, 'none', pluginContext);
    expect(pluginContext.json).toHaveBeenCalledWith(response, 200, { id: 'none', system: null });
  });

  it('returns 404 for missing captures and 405 for unsupported methods', async () => {
    const missingContext = context(null);
    await createSystemPromptServerPlugin().handleApi!(request(), response, 'missing', missingContext);
    expect(missingContext.json).toHaveBeenCalledWith(response, 404, { error: 'Capture not found' });

    const methodContext = context(null);
    await createSystemPromptServerPlugin().handleApi!(request('POST'), response, 'missing', methodContext);
    expect(methodContext.json).toHaveBeenCalledWith(response, 405, { error: 'Method not allowed' });
    expect(methodContext.readCapture).not.toHaveBeenCalled();
  });
});
