import { describe, expect, it, vi } from 'vitest';
import { ServerPluginRegistry } from '../src/registry/server.js';
import type { ServerPluginContext } from '../src/contracts/server.js';

const context = (): ServerPluginContext => ({
  analysisPath: '/tmp/analysis.jsonl', captures: [], readCapture: vi.fn(), parseProviderRequest: vi.fn(), parseProviderResponse: vi.fn(), json: vi.fn(), reportError: vi.fn(),
});

describe('ServerPluginRegistry', () => {
  it('rejects invalid and duplicate IDs', () => {
    expect(() => new ServerPluginRegistry([{ id: 'Bad ID' }])).toThrow(/Invalid/);
    expect(() => new ServerPluginRegistry([{ id: 'raw' }, { id: 'raw' }])).toThrow(/Duplicate/);
  });

  it.each(['logs', 'assets', 'brand'])('rejects reserved ID %s', (id) => {
    expect(() => new ServerPluginRegistry([{ id }])).toThrow(/Reserved/);
  });

  it('initializes in order and isolates capture and eviction failures', async () => {
    const events: string[] = [];
    const registry = new ServerPluginRegistry([
      { id: 'one', async init() { events.push('init-one'); }, async onCapture() { throw new Error('capture'); }, onEvict() { throw new Error('evict'); } },
      { id: 'two', async init() { events.push('init-two'); }, async onCapture() { events.push('capture-two'); } },
    ]);
    const pluginContext = context();
    await registry.init(pluginContext);
    const entry = { id: 'id', timestamp: '', token_hash: 'token', model: null, usage: {}, file_ref: '', messages: [] };
    await registry.onCapture({ ...entry }, entry);
    registry.onEvict(entry);
    expect(events).toEqual(['init-one', 'init-two', 'capture-two']);
    expect(pluginContext.reportError).toHaveBeenCalledTimes(2);
  });

  it('fails startup when initialization fails', async () => {
    const registry = new ServerPluginRegistry([{ id: 'broken', async init() { throw new Error('boom'); } }]);
    await expect(registry.init(context())).rejects.toThrow(/broken failed to initialize/);
  });

  it('dispatches APIs by plugin ID and leaves unknown routes unhandled', async () => {
    const handler = vi.fn().mockResolvedValue(true);
    const registry = new ServerPluginRegistry([{ id: 'trace', handleApi: handler }]);
    const pluginContext = context();
    await registry.init(pluginContext);
    const request = { method: 'GET' } as never;
    const response = {} as never;

    await expect(registry.handleApi('trace', request, response, 'capture-id')).resolves.toBe(true);
    expect(handler).toHaveBeenCalledWith(request, response, 'capture-id', pluginContext);
    await expect(registry.handleApi('missing', request, response, '')).resolves.toBe(false);
  });

  it('turns plugin API failures into isolated 500 responses', async () => {
    const registry = new ServerPluginRegistry([{
      id: 'broken',
      async handleApi() { throw new Error('boom'); },
    }]);
    const pluginContext = context();
    await registry.init(pluginContext);
    const response = { headersSent: false, end: vi.fn() } as never;

    await expect(registry.handleApi('broken', { method: 'GET' } as never, response, 'id')).resolves.toBe(true);
    expect(pluginContext.reportError).toHaveBeenCalledWith('broken', expect.any(Error));
    expect(pluginContext.json).toHaveBeenCalledWith(response, 500, { error: 'Plugin request failed' });
  });
});
