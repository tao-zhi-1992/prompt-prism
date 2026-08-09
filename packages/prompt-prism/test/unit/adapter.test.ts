import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest, parseResponse } from '../../src/adapter/anthropic.js';

test('normalizes Anthropic model input into ordered provider-neutral sections', () => {
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }] }];
  const system = [{ type: 'text', text: 'Be concise' }];
  const tools = [{ name: 'search', input_schema: { type: 'object' } }];
  const parsed = parseRequest(JSON.stringify({ model: 'claude-test', max_tokens: 42, stream: true, system, tools, messages }));
  assert.equal(parsed.model, 'claude-test');
  assert.deepEqual(parsed.messages, messages);
  assert.equal(parsed.input.adapter_id, 'anthropic');
  assert.equal(parsed.input.primary_section_id, 'messages');
  assert.deepEqual(parsed.input.primary_sequence, [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
  assert.deepEqual(parsed.input.sections.map(({ id, label, order, default_collapsed }) => ({ id, label, order, default_collapsed })), [
    { id: 'messages', label: 'Messages', order: 10, default_collapsed: false },
    { id: 'system', label: 'System', order: 20, default_collapsed: true },
    { id: 'tools', label: 'Tools', order: 30, default_collapsed: true },
    { id: 'options', label: 'Request options', order: 40, default_collapsed: true },
  ]);
  assert.deepEqual(parsed.input.sections.find(({ id }) => id === 'system')?.value, system);
  assert.deepEqual(parsed.input.sections.find(({ id }) => id === 'tools')?.value, tools);
  assert.deepEqual(parsed.input.sections.find(({ id }) => id === 'options')?.value, { model: 'claude-test', max_tokens: 42, stream: true });
});

test('parses JSON and SSE usage', () => {
  assert.equal(parseResponse(JSON.stringify({ usage: { input_tokens: 4, cache_read_input_tokens: 3 } }), 'application/json').usage.cache_read_input_tokens, 3);
  const sse = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":8,"cache_read_input_tokens":6}}}\n\nevent: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":2}}\n\n';
  assert.deepEqual(parseResponse(sse, 'text/event-stream').usage, {
    input_tokens: 8, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 6
  });
});
