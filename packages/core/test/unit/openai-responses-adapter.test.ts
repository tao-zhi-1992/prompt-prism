import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest, parseResponse } from '../../src/adapter/openai-responses.js';
import { protocolFixture, sse } from '../fixtures/protocols.js';

test('normalizes Responses input, instructions, custom tools, and function output', async () => {
  const fixture = await protocolFixture('openai-responses');
  const parsed = parseRequest(JSON.stringify(fixture.request));
  assert.equal(parsed.input.adapter_id, 'openai-responses');
  assert.deepEqual(parsed.input.conversation, [
    { role: 'user', content: [{ type: 'text', text: 'Read README' }] },
    { role: 'tool', content: [{ type: 'tool_result', tool_call_id: 'call_0', content: 'file text', is_error: null }] },
  ]);
  assert.equal(parsed.input.sections.find((section) => section.id === 'instructions')?.value, 'Be concise');
});

test('normalizes Responses JSON output including reasoning, functions, and provider tools', async () => {
  const fixture = await protocolFixture('openai-responses');
  const parsed = parseResponse(JSON.stringify(fixture.response), 'application/json');
  assert.deepEqual(parsed.usage, { input_tokens: 12, output_tokens: 3 });
  assert.deepEqual(parsed.output?.content.slice(0, 3), [
    { type: 'reasoning', text: 'Need a file' },
    { type: 'tool_call', id: 'call_1', name: 'read_file', input: { path: 'README.md' } },
    { type: 'text', text: 'done' },
  ]);
  assert.equal(parsed.output?.content[3]?.type, 'unknown');
});

test('assembles Responses SSE text, reasoning, and function arguments', async () => {
  const fixture = await protocolFixture('openai-responses');
  const parsed = parseResponse(sse(fixture.sse), 'text/event-stream');
  assert.deepEqual(parsed.output?.content, [
    { type: 'reasoning', text: 'Need' }, { type: 'text', text: 'done' }, { type: 'tool_call', id: 'call_1', name: 'read_file', input: { path: 'README.md' } },
  ]);
});
