import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiFormatResolver } from '../../src/adapter/detection.js';
import { resolveProxyTarget } from '../../src/proxy-target.js';
import { parseDynamicUpstreamRoute } from '../../src/upstream.js';

test('resolves a fixed Base URL with detected endpoint and client query', () => {
  const result = resolveProxyTarget({
    requestUrl: '/custom?stream=true',
    headers: { 'anthropic-version': '2023-06-01' },
    dynamicRoute: null,
    upstreamMode: 'base',
    upstreamUrl: new URL('https://api.example.com/provider/v1'),
    resolver: new ApiFormatResolver('auto'),
  });
  assert.equal(result.targetUrl.href, 'https://api.example.com/provider/v1/v1/messages?stream=true');
  assert.equal(result.headerProtocol, 'anthropic-messages');
});

test('uses the dynamic request endpoint and its own upstream hint', () => {
  const encoded = Buffer.from('https://api.openai.com/v1').toString('base64url');
  const dynamicRoute = parseDynamicUpstreamRoute(`/_proxy/${encoded}/chat/completions?stream=true`);
  const result = resolveProxyTarget({
    requestUrl: `/_proxy/${encoded}/chat/completions?stream=true`,
    headers: {},
    dynamicRoute,
    upstreamMode: 'base',
    upstreamUrl: new URL('https://api.anthropic.com'),
    resolver: new ApiFormatResolver('auto', new URL('https://api.anthropic.com')),
  });
  assert.equal(result.targetUrl.href, 'https://api.openai.com/v1/chat/completions?stream=true');
  assert.equal(result.upstreamHint, 'openai-chat-completions');
  assert.equal(result.requestPath, '/chat/completions');
});

test('preserves an exact upstream endpoint while forwarding client query', () => {
  const result = resolveProxyTarget({
    requestUrl: '/ignored?region=cn',
    headers: {},
    dynamicRoute: null,
    upstreamMode: 'exact',
    upstreamUrl: new URL('https://api.example.com/v1/messages?fixed=true'),
    resolver: new ApiFormatResolver('auto'),
  });
  assert.equal(result.targetUrl.href, 'https://api.example.com/v1/messages?fixed=true');
});

test('rejects target resolution without a fixed or dynamic upstream', () => {
  assert.throws(() => resolveProxyTarget({
    requestUrl: '/v1/messages',
    headers: {},
    dynamicRoute: null,
    upstreamMode: 'none',
    upstreamUrl: null,
    resolver: new ApiFormatResolver('auto'),
  }), /No upstream target available/);
});
