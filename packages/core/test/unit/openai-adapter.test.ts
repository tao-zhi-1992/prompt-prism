import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest, parseResponse } from '../../src/adapter/openai.js';
import { protocolFixture, sse } from '../fixtures/protocols.js';

test('normalizes OpenAI chat input into provider-neutral sections and conversation blocks', () => {
  const parsed = parseRequest(JSON.stringify({
    model: 'openai-test',
    temperature: 0.2,
    stream: true,
    tools: [{ type: 'function', function: { name: 'read', parameters: { type: 'object' } } }],
    messages: [
      { role: 'system', content: 'System one' },
      { role: 'developer', content: 'Developer two' },
      { role: 'user', content: [{ type: 'text', text: 'Inspect' }, { type: 'image_url', image_url: { url: 'https://example.com/a.png' } }] },
      {
        role: 'assistant', reasoning_content: 'Need tools', content: 'Calling now',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"a.ts"}' } },
          { id: 'call_2', type: 'function', function: { name: 'write', arguments: '{bad' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'file contents' },
    ],
  }));

  assert.equal(parsed.model, 'openai-test');
  assert.equal(parsed.messages.length, 5);
  assert.equal(parsed.input.adapter_id, 'openai-chat-completions');
  assert.equal(parsed.input.primary_section_id, 'messages');
  assert.deepEqual(parsed.input.sections.map(({ id, default_collapsed }) => ({ id, default_collapsed })), [
    { id: 'messages', default_collapsed: false },
    { id: 'system', default_collapsed: true },
    { id: 'tools', default_collapsed: true },
    { id: 'options', default_collapsed: true },
  ]);
  assert.deepEqual(parsed.input.sections.find(({ id }) => id === 'system')?.value, [
    { role: 'system', content: 'System one' },
    { role: 'developer', content: 'Developer two' },
  ]);
  assert.equal((parsed.input.sections.find(({ id }) => id === 'messages')?.value as unknown[]).length, 3);
  assert.deepEqual(parsed.input.sections.find(({ id }) => id === 'options')?.value, {
    model: 'openai-test', temperature: 0.2, stream: true,
  });
  assert.deepEqual(parsed.input.conversation, [
    { role: 'user', content: [
      { type: 'text', text: 'Inspect' },
      { type: 'unknown', provider_type: 'image_url', value: { type: 'image_url', image_url: { url: 'https://example.com/a.png' } } },
    ] },
    { role: 'assistant', content: [
      { type: 'reasoning', text: 'Need tools' },
      { type: 'text', text: 'Calling now' },
      { type: 'tool_call', id: 'call_1', name: 'read', input: { path: 'a.ts' } },
      { type: 'tool_call', id: 'call_2', name: 'write', input: null, input_raw: '{bad' },
    ] },
    { role: 'tool', content: [{ type: 'tool_result', tool_call_id: 'call_1', content: 'file contents', is_error: null }] },
  ]);
});

test('normalizes OpenAI JSON completions, choices, usage, extensions, and errors', () => {
  const parsed = parseResponse(JSON.stringify({
    id: 'chatcmpl_1', object: 'chat.completion', model: 'openai-test',
    choices: [
      { index: 1, finish_reason: 'stop', message: { role: 'assistant', content: 'alternative' } },
      {
        index: 0, finish_reason: 'tool_calls', message: {
          role: 'assistant', reasoning_content: 'inspect first', content: 'Working', refusal: 'not this part', vendor_field: 42,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"src/a.ts"}' } }],
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 60 } },
  }), 'application/json');

  assert.deepEqual(parsed.usage, { input_tokens: 40, output_tokens: 20, cache_read_input_tokens: 60 });
  assert.equal(parsed.output?.adapter_id, 'openai-chat-completions');
  assert.equal(parsed.output?.stop_reason, 'tool_calls');
  assert.deepEqual(parsed.output?.content, [
    { type: 'reasoning', text: 'inspect first' },
    { type: 'text', text: 'Working' },
    { type: 'unknown', provider_type: 'refusal', value: 'not this part' },
    { type: 'tool_call', id: 'call_1', name: 'read', input: { path: 'src/a.ts' } },
    { type: 'unknown', provider_type: 'openai_message_fields', value: { vendor_field: 42 } },
    { type: 'unknown', provider_type: 'openai_choice', value: { index: 1, finish_reason: 'stop', message: { role: 'assistant', content: 'alternative' } } },
  ]);

  const clamped = parseResponse(JSON.stringify({
    choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 9 } },
  }), 'application/json');
  assert.deepEqual(clamped.usage, { input_tokens: 0, output_tokens: 1, cache_read_input_tokens: 9 });

  const failed = parseResponse(JSON.stringify({ error: { message: 'bad key', type: 'invalid_request_error', code: 'invalid_api_key' } }), 'application/json');
  assert.equal(failed.output?.error?.type, 'invalid_request_error');
  assert.equal(failed.output?.error?.message, 'bad key');
});

test('assembles OpenAI SSE text, reasoning, parallel tool calls, choices, and usage', () => {
  const chunks = [
    { id: 'chatcmpl_sse', object: 'chat.completion.chunk', model: 'openai-stream', choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'inspect ' }, finish_reason: null }] },
    { id: 'chatcmpl_sse', choices: [{ index: 0, delta: { reasoning_content: 'first', content: 'hello ' }, finish_reason: null }] },
    { id: 'chatcmpl_sse', choices: [{ index: 0, delta: { vendor_delta: { trace: 'ignore' } }, finish_reason: null }] },
    { id: 'chatcmpl_sse', choices: [{ index: 0, delta: { content: 'world', tool_calls: [
      { index: 0, id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":' } },
      { index: 1, id: 'call_2', type: 'function', function: { name: 'write', arguments: '{bad' } },
    ] }, finish_reason: null }] },
    { id: 'chatcmpl_sse', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] }, finish_reason: 'tool_calls' }] },
    { id: 'chatcmpl_sse', choices: [{ index: 1, delta: { role: 'assistant', content: 'alternative' }, finish_reason: 'stop' }] },
    { id: 'chatcmpl_sse', choices: [], usage: { prompt_tokens: 30, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 20 } } },
  ];
  const sse = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`;
  const parsed = parseResponse(sse, 'text/event-stream; charset=utf-8');

  assert.deepEqual(parsed.usage, { input_tokens: 10, output_tokens: 7, cache_read_input_tokens: 20 });
  assert.equal(parsed.output?.id, 'chatcmpl_sse');
  assert.equal(parsed.output?.model, 'openai-stream');
  assert.equal(parsed.output?.stop_reason, 'tool_calls');
  assert.deepEqual(parsed.output?.content.slice(0, 4), [
    { type: 'reasoning', text: 'inspect first' },
    { type: 'text', text: 'hello world' },
    { type: 'tool_call', id: 'call_1', name: 'read', input: { path: 'a.ts' } },
    { type: 'tool_call', id: 'call_2', name: 'write', input: null, input_raw: '{bad' },
  ]);
  assert.equal(parsed.output?.content[4]?.type, 'unknown');
  assert.equal(parsed.output?.content[4]?.type === 'unknown' ? parsed.output.content[4].provider_type : null, 'openai_choice');
  assert.equal(parsed.output?.content.some((block) => block.type === 'unknown' && block.visibility === 'internal'), false);
});

test('supports legacy function_call and rejects malformed or unrecognized responses', () => {
  const request = parseRequest(JSON.stringify({ model: 'legacy', messages: [{ role: 'assistant', function_call: { name: 'lookup', arguments: '{}' } }] }));
  assert.deepEqual(request.input.conversation?.[0]?.content, [{ type: 'tool_call', id: null, name: 'lookup', input: {} }]);

  assert.equal(parseResponse('', 'application/json').output, null);
  assert.equal(parseResponse('{}', 'application/json').output, null);
  assert.equal(parseResponse('data: nope\n\ndata: [DONE]\n\n', 'text/event-stream').output, null);
});

test('normalizes the tracked OpenAI Chat Completions fixture', async () => {
  const fixture = await protocolFixture('openai-chat-completions');
  const request = parseRequest(JSON.stringify(fixture.request));
  const response = parseResponse(JSON.stringify(fixture.response));
  const stream = parseResponse(sse(fixture.sse), 'text/event-stream');
  assert.equal(request.input.adapter_id, 'openai-chat-completions');
  assert.deepEqual(request.input.conversation, [{ role: 'user', content: [{ type: 'text', text: 'Read README' }] }]);
  assert.deepEqual(response.output?.content.slice(0, 3), [
    { type: 'reasoning', text: 'Need a file' }, { type: 'text', text: 'Reading' }, { type: 'tool_call', id: 'call_1', name: 'read_file', input: { path: 'README.md' } },
  ]);
  assert.deepEqual(stream.output?.content, [{ type: 'text', text: 'done' }]);
});
