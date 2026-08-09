import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiFormatResolver, detectProtocolFromBaseUrl, detectProtocolFromBody, detectProtocolFromPath } from '../../src/adapter/detection.js';

test('detects canonical protocols from standard endpoints and provider Base URLs', () => {
  assert.equal(detectProtocolFromPath('/v1/messages'), 'anthropic-messages');
  assert.equal(detectProtocolFromPath('/v1/chat/completions'), 'openai-chat-completions');
  assert.equal(detectProtocolFromPath('/v1/responses'), 'openai-responses');
  assert.equal(detectProtocolFromBaseUrl(new URL('https://api.deepseek.com')), 'openai-chat-completions');
  assert.equal(detectProtocolFromBaseUrl(new URL('https://api.stepfun.com/step_plan')), 'anthropic-messages');
  assert.equal(detectProtocolFromBaseUrl(new URL('https://custom.example.com/gateway')), null);
});

test('only uses provider-specific body evidence and locks the first confident result', () => {
  assert.equal(detectProtocolFromBody(JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hello' }] })), null);
  assert.equal(detectProtocolFromBody(JSON.stringify({ model: 'm', messages: [], tools: [{ name: 'read', input_schema: { type: 'object' } }] })), 'anthropic-messages');
  assert.equal(detectProtocolFromBody(JSON.stringify({ model: 'm', messages: [], tools: [{ type: 'function', function: { name: 'read' } }] })), 'openai-chat-completions');

  const resolver = new ApiFormatResolver('auto', new URL('https://custom.example.com'), false);
  assert.equal(resolver.resolution.resolved, null);
  resolver.consider('openai-chat-completions', 'request-path');
  resolver.consider('anthropic-messages', 'request-shape');
  assert.equal(resolver.resolution.resolved, 'openai-chat-completions');
  assert.equal(resolver.resolution.source, 'request-path');
});
