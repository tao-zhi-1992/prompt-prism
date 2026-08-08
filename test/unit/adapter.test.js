import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest, parseResponse } from '../../src/adapter/anthropic.js';

test('parses request model and structured messages', () => {
  const body = JSON.stringify({ model: 'claude-test', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] });
  assert.deepEqual(parseRequest(body), { model: 'claude-test', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] });
});

test('parses JSON and SSE usage', () => {
  assert.equal(parseResponse(JSON.stringify({ usage: { input_tokens: 4, cache_read_input_tokens: 3 } }), 'application/json').usage.cache_read_input_tokens, 3);
  const sse = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":8,"cache_read_input_tokens":6}}}\n\nevent: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":2}}\n\n';
  assert.deepEqual(parseResponse(sse, 'text/event-stream').usage, {
    input_tokens: 8, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 6
  });
});
