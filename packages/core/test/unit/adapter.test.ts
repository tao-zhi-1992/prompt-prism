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
  assert.equal(parsed.input.adapter_id, 'anthropic-messages');
  assert.equal(parsed.input.primary_section_id, 'messages');
  assert.deepEqual(parsed.input.primary_sequence, [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
  assert.deepEqual(parsed.input.conversation, [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
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

test('normalizes Anthropic tool and reasoning history into provider-neutral conversation', () => {
  const parsed = parseRequest(JSON.stringify({ model: 'claude-test', messages: [
    { role: 'assistant', content: [
      { type: 'thinking', thinking: 'inspect', signature: 'hidden' },
      { type: 'tool_use', id: 'tool_1', name: 'read', input: { path: 'a.ts' } },
    ] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'file text', is_error: false }] },
  ] }));
  assert.deepEqual(parsed.input.conversation, [
    { role: 'assistant', content: [
      { type: 'reasoning', text: 'inspect' },
      { type: 'tool_call', id: 'tool_1', name: 'read', input: { path: 'a.ts' } },
    ] },
    { role: 'user', content: [{ type: 'tool_result', tool_call_id: 'tool_1', content: 'file text', is_error: false }] },
  ]);
  assert.equal(JSON.stringify(parsed.input.conversation).includes('hidden'), false);
});

test('normalizes Anthropic JSON output blocks and provider errors', () => {
  const parsed = parseResponse(JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-test', stop_reason: 'tool_use',
    content: [
      { type: 'thinking', thinking: 'inspect first', signature: 'secret-signature' },
      { type: 'text', text: '<b>literal</b>' },
      { type: 'tool_use', id: 'tool_1', name: 'read', input: { path: 'src/a.ts' } },
      { type: 'citation', url: 'https://example.com' },
    ],
    usage: { input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 2 },
  }), 'application/json');
  assert.deepEqual(parsed.usage, { input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 2 });
  assert.deepEqual(parsed.output, {
    adapter_id: 'anthropic-messages', id: 'msg_1', model: 'claude-test', role: 'assistant', stop_reason: 'tool_use',
    content: [
      { type: 'reasoning', text: 'inspect first' },
      { type: 'text', text: '<b>literal</b>' },
      { type: 'tool_call', id: 'tool_1', name: 'read', input: { path: 'src/a.ts' } },
      { type: 'unknown', provider_type: 'citation', value: { type: 'citation', url: 'https://example.com' } },
    ],
    usage: { input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 2 },
  });
  assert.equal(JSON.stringify(parsed.output).includes('secret-signature'), false);

  const failed = parseResponse(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }), 'application/json');
  assert.equal(failed.output?.error?.type, 'authentication_error');
  assert.equal(failed.output?.error?.message, 'bad key');
  assert.deepEqual(failed.usage, {});
});

test('assembles Anthropic SSE text, thinking, tool arguments, usage, and stop reason', () => {
  const events = [
    { type: 'message_start', message: { id: 'msg_sse', role: 'assistant', model: 'claude-sse', usage: { input_tokens: 8, cache_read_input_tokens: 6 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'inspect ' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'first' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'hidden' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'hello ' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'world' } },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tool_1', name: 'read', input: {} } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"path":' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"src/a.ts"}' } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
    { type: 'message_stop' },
  ];
  const sse = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  const parsed = parseResponse(sse, 'text/event-stream');
  assert.deepEqual(parsed.usage, { input_tokens: 8, output_tokens: 9, cache_read_input_tokens: 6 });
  assert.deepEqual(parsed.output, {
    adapter_id: 'anthropic-messages', id: 'msg_sse', model: 'claude-sse', role: 'assistant', stop_reason: 'tool_use',
    content: [
      { type: 'reasoning', text: 'inspect first' },
      { type: 'text', text: 'hello world' },
      { type: 'tool_call', id: 'tool_1', name: 'read', input: { path: 'src/a.ts' } },
    ],
    usage: { input_tokens: 8, output_tokens: 9, cache_read_input_tokens: 6 },
  });
  assert.equal(JSON.stringify(parsed.output).includes('hidden'), false);
});

test('preserves malformed tool JSON and ignores malformed or unrecognized responses', () => {
  const invalidTool = [
    'data: {not-json}',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_bad","name":"write","input":{}}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{bad"}}',
  ].join('\n\n');
  assert.deepEqual(parseResponse(invalidTool, 'text/event-stream').output?.content, [
    { type: 'tool_call', id: 'tool_bad', name: 'write', input: null, input_raw: '{bad' },
  ]);
  assert.equal(parseResponse('', 'application/json').output, null);
  assert.equal(parseResponse('{}', 'application/json').output, null);
  assert.equal(parseResponse('data: nope\n\n', 'text/event-stream').output, null);
});
