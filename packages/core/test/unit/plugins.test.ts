import http from 'node:http';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerPluginRegistry } from '../../src/plugins.js';
import type { Capture, CaptureIndexEntry, PromptPrismServerPlugin, ServerPluginContext } from '@prompt-prism/contracts/server';

function context(): ServerPluginContext {
  return {
    analysisPath: '/tmp/analysis.jsonl',
    captures: [],
    readCapture: async () => null,
    parseProviderRequest: () => { throw new Error('not used'); },
    parseProviderResponse: () => { throw new Error('not used'); },
    json: () => undefined,
    reportError: () => undefined,
  };
}

function entry(): CaptureIndexEntry {
  return { id: 'capture', timestamp: '2026-08-14T00:00:00.000Z', token_hash: 'token', model: 'model', usage: {}, file_ref: 'capture.json', messages: [] };
}

function capture(): Capture {
  return { ...entry() };
}

function response(headersSent = false): http.ServerResponse {
  return { headersSent, end: () => undefined } as unknown as http.ServerResponse;
}

test('validates IDs and rejects calls before initialization', async () => {
  assert.throws(() => new ServerPluginRegistry([{ id: 'Bad ID' }]), /Invalid plugin ID/);
  assert.throws(() => new ServerPluginRegistry([{ id: 'logs' }]), /Reserved plugin ID/);
  assert.throws(() => new ServerPluginRegistry([{ id: 'same' }, { id: 'same' }]), /Duplicate plugin ID/);

  const registry = new ServerPluginRegistry();
  assert.throws(() => registry.onEvict(entry()), /not been initialized/);
  await assert.rejects(registry.onCapture(capture(), entry()), /not been initialized/);
  await assert.rejects(registry.onClear(), /not been initialized/);
  await assert.rejects(registry.handleApi('missing', {} as http.IncomingMessage, response(), ''), /not been initialized/);
});

test('isolates optional lifecycle hooks and reports failures', async () => {
  const errors: Array<[string, unknown]> = [];
  const pluginContext = context();
  pluginContext.reportError = (id, error) => errors.push([id, error]);
  const plugins: PromptPrismServerPlugin[] = [
    {
      id: 'broken',
      async onCapture() { throw new Error('capture failed'); },
      onEvict() { throw new Error('evict failed'); },
      onClear() { throw new Error('clear failed'); },
    },
    { id: 'quiet' },
  ];
  const registry = new ServerPluginRegistry(plugins);
  await registry.init(pluginContext);
  await registry.onCapture(capture(), entry());
  registry.onEvict(entry());
  await assert.rejects(registry.onClear(), /failed to clear/);
  assert.deepEqual(errors.map(([id]) => id), ['broken', 'broken', 'broken']);
});

test('wraps initialization and API failures while dispatching valid APIs', async () => {
  const initFailure = new ServerPluginRegistry([{ id: 'broken', async init() { throw new Error('init failed'); } }]);
  await assert.rejects(initFailure.init(context()), /broken failed to initialize/);

  const errors: unknown[] = [];
  const pluginContext = context();
  pluginContext.reportError = (_id, error) => errors.push(error);
  const handled = new ServerPluginRegistry([{
    id: 'handled',
    async handleApi(request, response, subpath) {
      assert.equal(request.method, 'GET');
      assert.equal(subpath, 'capture');
      assert.ok(response);
      return true;
    },
  }]);
  await handled.init(pluginContext);
  const request = { method: 'GET' } as http.IncomingMessage;
  const okResponse = response();
  assert.equal(await handled.handleApi('handled', request, okResponse, 'capture'), true);
  assert.equal(await handled.handleApi('missing', request, okResponse, ''), false);

  const broken = new ServerPluginRegistry([{
    id: 'broken-api',
    async handleApi() { throw new Error('api failed'); },
  }]);
  await broken.init(pluginContext);
  const failedResponse = response();
  assert.equal(await broken.handleApi('broken-api', request, failedResponse, 'capture'), true);
  assert.equal(errors.length, 1);

  const endedResponse = { headersSent: true, end: () => undefined } as unknown as http.ServerResponse;
  assert.equal(await broken.handleApi('broken-api', request, endedResponse, 'capture'), true);
});
