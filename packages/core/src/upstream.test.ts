import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDynamicProxyBaseUrl,
  decodeUpstreamUrl,
  encodeUpstreamUrl,
  parseDynamicUpstreamRoute,
  parseUpstreamBaseUrl,
} from './upstream.js';

test('encodes upstream URLs as canonical unpadded Base64URL', () => {
  const encodedUpstream = encodeUpstreamUrl('https://例子.example/模型/v1///');
  assert.match(encodedUpstream, /^[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(encodedUpstream, /=/);
  assert.equal(decodeUpstreamUrl(encodedUpstream).href, 'https://xn--fsqu00a.example/%E6%A8%A1%E5%9E%8B/v1///');
  assert.equal(encodeUpstreamUrl(decodeUpstreamUrl(encodedUpstream)), encodedUpstream);
});

test('builds a dynamic proxy Base URL and separates its endpoint and query', () => {
  const baseUrl = buildDynamicProxyBaseUrl('https://provider.example.com/gateway/v1', 'http://127.0.0.1:2048');
  assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:2048\/_proxy\/[A-Za-z0-9_-]+$/);
  const route = parseDynamicUpstreamRoute(`${new URL(baseUrl).pathname}/chat/completions?region=cn`);
  assert.equal(route?.baseUrl.href, 'https://provider.example.com/gateway/v1');
  assert.equal(route?.requestPath, '/chat/completions');
  assert.equal(route?.requestUrl, '/chat/completions?region=cn');
  assert.equal(route?.requestSuffix, '/chat/completions');
  assert.equal(parseDynamicUpstreamRoute('/v1/messages'), null);
});

test('encodes complete dynamic upstream URLs without rewriting them', () => {
  const upstream = 'https://api.stepfun.com/step_plan/v1/chat/completions';
  const proxyUrl = buildDynamicProxyBaseUrl(upstream, 'http://127.0.0.1:2048');
  const route = parseDynamicUpstreamRoute(new URL(proxyUrl).pathname);
  assert.equal(route?.baseUrl.href, upstream);
  assert.equal(route?.requestSuffix, null);
  assert.equal(route?.requestPath, '/');
  assert.equal(route?.requestUrl, '/');
});

test('rejects unsafe, endpoint, oversized, and non-canonical dynamic upstream values', () => {
  assert.throws(() => parseUpstreamBaseUrl('ftp://provider.example.com'), /http or https/);
  assert.throws(() => parseUpstreamBaseUrl('https://user:secret@provider.example.com/v1'), /credentials/);
  assert.throws(() => parseUpstreamBaseUrl('https://provider.example.com/v1?region=cn'), /must not contain a query/);
  assert.throws(() => parseUpstreamBaseUrl('https://provider.example.com/v1#fragment'), /fragment/);
  assert.throws(() => parseUpstreamBaseUrl('https://provider.example.com/v1/messages'), /must not include an API endpoint/);
  assert.throws(() => parseUpstreamBaseUrl(`https://provider.example.com/${'a'.repeat(4096)}`), /4096 bytes/);
  assert.throws(() => decodeUpstreamUrl('bad='), /Invalid encoded upstream value/);
  assert.throws(() => decodeUpstreamUrl('a'), /Invalid encoded upstream value/);
  assert.throws(() => decodeUpstreamUrl(Buffer.from('https://provider.example.com/v1?region=cn').toString('base64url')), /Invalid encoded upstream value/);
  assert.throws(() => parseDynamicUpstreamRoute('/_proxy//v1/messages'), /Invalid encoded upstream value/);
  assert.throws(() => buildDynamicProxyBaseUrl('https://provider.example.com/v1', 'http://127.0.0.1:1028/prefix'), /must be an origin/);
});
