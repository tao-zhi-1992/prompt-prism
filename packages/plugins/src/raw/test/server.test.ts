import { describe, expect, it, vi } from 'vitest';
import { createRawServerPlugin } from '../server/index.js';
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

describe('Raw server plugin', () => {
  it('returns captured request and response data', async () => {
    const raw = {
      request: { method: 'POST', url: '/v1/messages', headers: {}, body: '{}' },
      response: { status: 200, headers: {}, body: 'ok' },
    };
    const pluginContext = context(raw);
    const handled = await createRawServerPlugin().handleApi!(request(), response, 'capture%20id', pluginContext);
    expect(handled).toBe(true);
    expect(pluginContext.readCapture).toHaveBeenCalledWith('capture id');
    expect(pluginContext.json).toHaveBeenCalledWith(response, 200, raw);
  });

  it('preserves null raw fields for historical captures', async () => {
    const pluginContext = context({ id: 'old' });
    await createRawServerPlugin().handleApi!(request(), response, 'old', pluginContext);
    expect(pluginContext.json).toHaveBeenCalledWith(response, 200, { request: null, response: null });
  });

  it('returns 404 for missing captures and 405 for unsupported methods', async () => {
    const missingContext = context(null);
    await createRawServerPlugin().handleApi!(request(), response, 'missing', missingContext);
    expect(missingContext.json).toHaveBeenCalledWith(response, 404, { error: 'Capture not found' });

    const methodContext = context(null);
    await createRawServerPlugin().handleApi!(request('POST'), response, 'missing', methodContext);
    expect(methodContext.json).toHaveBeenCalledWith(response, 405, { error: 'Method not allowed' });
    expect(methodContext.readCapture).not.toHaveBeenCalled();
  });
});
