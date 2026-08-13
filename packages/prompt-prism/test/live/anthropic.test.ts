import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createPromptPrism } from '../../src/index.js';

const apiKey = process.env.TEST_TOKEN || process.env.ANTHROPIC_API_KEY;
const testEndpoint = process.env.TEST_ANTHROPIC;
const testModel = process.env.ANTHROPIC_TEST_MODEL || (testEndpoint ? 'step-3.7-flash' : 'claude-haiku-4-5-20251001');

test('live Anthropic SSE request streams through proxy', { skip: !apiKey }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-live-'));
  const prism = await createPromptPrism({ dataDir: dir, upstreamUrl: testEndpoint ?? 'https://api.anthropic.com/v1/messages' });
  await new Promise<void>((resolve) => prism.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => prism.server.close((error) => error ? reject(error) : resolve())));
  const port = (prism.server.address() as AddressInfo).port;
  const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: testModel, max_tokens: 8, stream: true, messages: [{ role: 'user', content: 'Reply OK' }] })
  });
  if (!response.ok) assert.fail(`Anthropic returned ${response.status}: ${await response.text()}`);
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
  const reader = response.body?.getReader();
  assert.ok(reader);
  const first = await reader.read();
  assert.equal(first.done, false);
  let bytes = first.value.length;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.length;
  }
  assert.ok(bytes > 0);
});
