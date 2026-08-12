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
  assert.deepEqual(capture.usage, { input_tokens: 3, output_tokens: 1 });
  assert.equal(capture.request?.headers.authorization, '[REDACTED]');
  assert.equal(capture.response?.headers['set-cookie'], '[REDACTED]');
  assert.equal(capture.timing?.time_to_first_byte_ms, 30);
});

test('keeps an unsupported response as Raw without leaking normalized fields', () => {
  const requestBody = Buffer.from(JSON.stringify({ model: 'gpt-test', input: 'hello' }));
  const capture = buildCapture({
    id: 'capture-raw',
    request: { method: 'POST', url: '/v1/responses', headers: {} },
    targetUrl: new URL('https://api.openai.com/v1/responses'),
    requestBody,
    responseBody: Buffer.from(JSON.stringify({ object: 'response', output: [] })),
    responseStatus: 200,
    responseHeaders: { 'content-type': 'application/json' },
    timing,
    resolver: new ApiFormatResolver('auto'),
    upstreamHint: null,
    pathProtocol: 'openai-responses',
    headerProtocol: null,
  });
  assert.equal(capture.adapter_id, 'unresolved');
  assert.equal(capture.model, 'gpt-test');
  assert.equal(capture.prompt_input, undefined);
  assert.equal(capture.model_output, undefined);
  assert.equal(capture.request?.body, requestBody.toString());
});
