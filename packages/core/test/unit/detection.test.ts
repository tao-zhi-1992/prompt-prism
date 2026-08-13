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

test('only uses provider-specific body evidence and resolves each capture independently', () => {
  assert.equal(detectProtocolFromBody(JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hello' }] })), null);
  assert.equal(detectProtocolFromBody(JSON.stringify({ model: 'm', messages: [], tools: [{ name: 'read', input_schema: { type: 'object' } }] })), 'anthropic-messages');
  assert.equal(detectProtocolFromBody(JSON.stringify({ model: 'm', messages: [], tools: [{ type: 'function', function: { name: 'read' } }] })), 'openai-chat-completions');
  assert.equal(detectProtocolFromBody(JSON.stringify({ model: 'm', input: [{ role: 'user', content: 'hello' }] })), 'openai-responses');

  const resolver = new ApiFormatResolver('auto', new URL('https://custom.example.com'), false);
  assert.equal(resolver.resolution.resolved, null);
  assert.equal(resolver.resolve('openai-chat-completions', 'anthropic-messages'), 'openai-chat-completions');
  assert.equal(resolver.resolve('anthropic-messages', 'openai-chat-completions'), 'anthropic-messages');
  assert.equal(resolver.resolve('openai-responses'), 'openai-responses');
  assert.equal(resolver.resolve('openai-chat-completions'), 'openai-chat-completions');
  assert.deepEqual(resolver.resolution, { mode: 'auto', configured: 'auto', resolved: null, source: null });
});

test('uses the upstream only as the final Auto fallback and explicit format before all evidence', () => {
  const auto = new ApiFormatResolver('auto', new URL('https://api.deepseek.com'), false);
  assert.equal(auto.resolve(), 'openai-chat-completions');
  assert.equal(auto.resolve('anthropic-messages'), 'anthropic-messages');

  const explicit = new ApiFormatResolver('anthropic', new URL('https://api.deepseek.com'), false);
  assert.equal(explicit.resolve('openai-chat-completions'), 'anthropic-messages');
});

test('does not use the implicit Anthropic default as an auto-format hint', () => {
  const resolver = new ApiFormatResolver('auto', new URL('https://api.anthropic.com'), false, false);
  assert.equal(resolver.resolution.resolved, null);
  assert.equal(resolver.resolution.source, null);
});
