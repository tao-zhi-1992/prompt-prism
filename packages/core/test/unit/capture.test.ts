import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiFormatResolver } from '../../src/adapter/detection.js';
import { buildCapture } from '../../src/capture.js';

const timing = {
  startedAt: '2026-08-12T00:00:00.000Z',
  completedAt: '2026-08-12T00:00:00.050Z',
  startedMs: 100,
  headersMs: 120,
  firstByteMs: 130,
  completedMs: 150,
};

test('builds a normalized capture and redacts sensitive headers', () => {
  const capture = buildCapture({
    id: 'capture-openai',
    request: {
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json', 'x-prompt-prism-trace-id': 'agent.checkout' },
    },
    targetUrl: new URL('https://api.openai.com/v1/chat/completions'),
    requestBody: Buffer.from(JSON.stringify({ model: 'gpt-test', messages: [{ role: 'user', content: 'hello' }] })),
    responseBody: Buffer.from(JSON.stringify({ object: 'chat.completion', model: 'gpt-test', choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } })),
    responseStatus: 200,
    responseHeaders: { 'content-type': 'application/json', 'set-cookie': ['secret'] },
    responseContentType: 'application/json',
    timing,
    resolver: new ApiFormatResolver('auto'),
    upstreamHint: null,
    pathProtocol: 'openai-chat-completions',
    headerProtocol: null,
  });
  assert.equal(capture.adapter_id, 'openai-chat-completions');
  assert.equal(capture.model, 'gpt-test');
  assert.equal(capture.trace_id, 'agent.checkout');
  assert.equal(capture.trace_parent_capture_id, undefined);
  assert.deepEqual(capture.usage, { input_tokens: 3, output_tokens: 1 });
  assert.equal(capture.request?.headers.authorization, '[REDACTED]');
  assert.equal(capture.response?.headers['set-cookie'], '[REDACTED]');
  assert.equal(capture.timing?.time_to_first_byte_ms, 30);
});

test('captures an explicit parent header without forwarding it upstream', () => {
  const capture = buildCapture({
    id: 'capture-child',
    request: {
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json', 'x-prompt-prism-parent-capture-id': 'capture-root' },
    },
    targetUrl: new URL('https://api.openai.com/v1/chat/completions'),
    requestBody: Buffer.from(JSON.stringify({ model: 'gpt-test', messages: [{ role: 'user', content: 'next' }] })),
    responseBody: Buffer.from(JSON.stringify({ object: 'chat.completion', choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }] })),
    responseStatus: 200,
    responseHeaders: { 'content-type': 'application/json' },
    responseContentType: 'application/json',
    timing,
    resolver: new ApiFormatResolver('auto'),
    upstreamHint: null,
    pathProtocol: 'openai-chat-completions',
    headerProtocol: null,
  });
  assert.equal(capture.trace_parent_capture_id, 'capture-root');
  assert.equal(capture.request?.headers['x-prompt-prism-parent-capture-id'], 'capture-root');
});

test('normalizes OpenAI Responses instead of falling back to Raw', () => {
  const requestBody = Buffer.from(JSON.stringify({ model: 'gpt-test', input: 'hello' }));
  const capture = buildCapture({
    id: 'capture-raw',
    request: { method: 'POST', url: '/v1/responses', headers: {} },
    targetUrl: new URL('https://api.openai.com/v1/responses'),
    requestBody,
    responseBody: Buffer.from(JSON.stringify({ id: 'resp_1', object: 'response', model: 'gpt-test', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] }], usage: { input_tokens: 3, output_tokens: 1 } })),
    responseStatus: 200,
    responseHeaders: { 'content-type': 'application/json' },
    timing,
    resolver: new ApiFormatResolver('auto'),
    upstreamHint: null,
    pathProtocol: 'openai-responses',
    headerProtocol: null,
  });
  assert.equal(capture.adapter_id, 'openai-responses');
  assert.equal(capture.model, 'gpt-test');
  assert.equal(capture.prompt_input?.adapter_id, 'openai-responses');
  assert.deepEqual(capture.model_output?.content, [{ type: 'text', text: 'hello' }]);
  assert.equal(capture.request?.body, requestBody.toString());
});
