import { describe, expect, it, vi } from 'vitest';
import type { ModelOutputSnapshot, ServerPluginContext } from '../../contracts/server.js';
import { createOutputServerPlugin } from '../server/index.js';

const request = (method = 'GET') => ({ method }) as never;
const response = {} as never;
const output: ModelOutputSnapshot = {
  adapter_id: 'anthropic', id: 'msg', model: 'model', role: 'assistant', stop_reason: 'end_turn',
  content: [{ type: 'text', text: 'done' }], usage: { output_tokens: 1 },
};

function context(capture: unknown): ServerPluginContext {
  return {
    analysisPath: '/tmp/analysis.jsonl', captures: [],
    readCapture: vi.fn().mockResolvedValue(capture),
    parseProviderRequest: vi.fn(),
    parseProviderResponse: vi.fn().mockReturnValue({ usage: output.usage, output }),
    json: vi.fn(), reportError: vi.fn(),
  };
}

describe('Output server plugin', () => {
  it('returns persisted normalized output without reparsing', async () => {
    const pluginContext = context({ id: 'capture', model_output: output });
    await createOutputServerPlugin().handleApi!(request(), response, 'capture', pluginContext);
    expect(pluginContext.json).toHaveBeenCalledWith(response, 200, { output });
    expect(pluginContext.parseProviderResponse).not.toHaveBeenCalled();
  });

  it('parses historical raw responses without mutating the capture', async () => {
    const capture = {
      id: 'old', adapter_id: 'anthropic',
      response: { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' }, body: 'event data' },
    };
    const pluginContext = context(capture);
    await createOutputServerPlugin().handleApi!(request(), response, 'old%20capture', pluginContext);
    expect(pluginContext.readCapture).toHaveBeenCalledWith('old capture');
    expect(pluginContext.parseProviderResponse).toHaveBeenCalledWith('anthropic', 'event data', 'text/event-stream; charset=utf-8');
    expect(pluginContext.json).toHaveBeenCalledWith(response, 200, { output });
    expect(capture).not.toHaveProperty('model_output');
  });

  it('returns null for unavailable or unsupported historical output', async () => {
    const noRaw = context({ id: 'old' });
    await createOutputServerPlugin().handleApi!(request(), response, 'old', noRaw);
    expect(noRaw.json).toHaveBeenCalledWith(response, 200, { output: null });

    const unsupported = context({ id: 'other', adapter_id: 'other', response: { headers: {}, body: '{}' } });
    vi.mocked(unsupported.parseProviderResponse).mockImplementation(() => { throw new Error('unsupported'); });
    await createOutputServerPlugin().handleApi!(request(), response, 'other', unsupported);
    expect(unsupported.json).toHaveBeenCalledWith(response, 200, { output: null });
  });

  it('returns 404 for missing captures and 405 for unsupported methods', async () => {
    const missing = context(null);
    await createOutputServerPlugin().handleApi!(request(), response, 'missing', missing);
    expect(missing.json).toHaveBeenCalledWith(response, 404, { error: 'Capture not found' });

    const wrongMethod = context(null);
    await createOutputServerPlugin().handleApi!(request('POST'), response, 'capture', wrongMethod);
    expect(wrongMethod.json).toHaveBeenCalledWith(response, 405, { error: 'Method not allowed' });
    expect(wrongMethod.readCapture).not.toHaveBeenCalled();
  });
});
