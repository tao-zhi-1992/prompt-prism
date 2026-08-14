import assert from 'node:assert/strict';
import test from 'node:test';
import { getProviderAdapter } from '../../src/adapter/registry.js';
import { detectProtocolFromBody, detectProtocolFromPath, detectProtocolFromResponse } from '../../src/adapter/detection.js';
import { protocolFixture, protocolSources, sse } from '../fixtures/protocols.js';

const protocols = ['anthropic-messages', 'openai-chat-completions', 'openai-responses'] as const;

test('protocol fixture manifest is complete, traceable, and valid', async () => {
  const sources = await protocolSources();
  assert.equal(sources.schema_version, 1);
  for (const id of protocols) {
    const source = sources.fixtures[id];
    assert.ok(source, `${id} source missing`); assert.ok(source.sources.length > 0); assert.ok(source.covers.includes('request')); assert.ok(source.covers.includes('json_response')); assert.ok(source.covers.includes('sse'));
    source.sources.forEach((item) => { assert.match(item.url, /^https:\/\//); assert.match(item.accessed_at, /^\d{4}-\d{2}-\d{2}$/); });
    const fixture = await protocolFixture(id);
    assert.ok(fixture.request && fixture.response && fixture.error && fixture.sse.length > 0);
  }
});

test('fixtures match their adapter endpoint and trusted protocol signals', async () => {
  const sources = await protocolSources();
  for (const id of protocols) {
    const adapter = getProviderAdapter(id); const fixture = await protocolFixture(id);
    assert.equal(adapter.detection.endpointPath, sources.fixtures[id]!.endpoint);
    assert.equal(detectProtocolFromPath(adapter.detection.endpointPath), id);
    assert.equal(detectProtocolFromBody(JSON.stringify(fixture.request)), id);
    assert.equal(detectProtocolFromResponse(JSON.stringify(fixture.response)), id);
    assert.equal(detectProtocolFromResponse(sse(fixture.sse)), id);
  }
});
