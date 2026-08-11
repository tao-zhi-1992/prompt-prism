import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDynamicProxyBaseUrl,
  decodeUpstreamBaseUrl,
  encodeUpstreamBaseUrl,
  parseDynamicUpstreamRoute,
  parseUpstreamBaseUrl,
} from '../../src/upstream.js';

test('encodes normalized upstream Base URLs as canonical unpadded Base64URL', () => {
  const token = encodeUpstreamBaseUrl('https://例子.example/模型/v1///');
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(token, /=/);
  assert.equal(decodeUpstreamBaseUrl(token).href, 'https://xn--fsqu00a.example/%E6%A8%A1%E5%9E%8B/v1');
  assert.equal(encodeUpstreamBaseUrl(decodeUpstreamBaseUrl(token)), token);
});

test('builds a dynamic proxy Base URL and separates its endpoint and query', () => {
  const baseUrl = buildDynamicProxyBaseUrl('https://provider.example.com/gateway/v1', 'http://127.0.0.1:2048');
  assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:2048\/_pp\/up\/[A-Za-z0-9_-]+$/);
  const route = parseDynamicUpstreamRoute(`${new URL(baseUrl).pathname}/chat/completions?region=cn`);
  assert.equal(route?.baseUrl.href, 'https://provider.example.com/gateway/v1');
  assert.equal(route?.requestPath, '/chat/completions');
  assert.equal(route?.requestUrl, '/chat/completions?region=cn');
  assert.equal(parseDynamicUpstreamRoute('/v1/messages'), null);
});

test('rejects unsafe, endpoint, oversized, and non-canonical dynamic upstream values', () => {
  assert.throws(() => parseUpstreamBaseUrl('ftp://provider.example.com'), /http or https/);
  assert.throws(() => parseUpstreamBaseUrl('https://user:secret@provider.example.com/v1'), /credentials/);
  assert.throws(() => parseUpstreamBaseUrl('https://provider.example.com/v1?region=cn'), /must not contain a query/);
  assert.throws(() => parseUpstreamBaseUrl('https://provider.example.com/v1#fragment'), /fragment/);
  assert.throws(() => parseUpstreamBaseUrl('https://provider.example.com/v1/messages'), /must not include an API endpoint/);
  assert.throws(() => parseUpstreamBaseUrl(`https://provider.example.com/${'a'.repeat(4096)}`), /4096 bytes/);
  assert.throws(() => decodeUpstreamBaseUrl('bad='), /Invalid dynamic upstream token/);
  assert.throws(() => decodeUpstreamBaseUrl('a'), /Invalid dynamic upstream token/);
  assert.throws(() => decodeUpstreamBaseUrl(Buffer.from('https://provider.example.com///').toString('base64url')), /Invalid dynamic upstream token/);
  assert.throws(() => parseDynamicUpstreamRoute('/_pp/up//v1/messages'), /Invalid dynamic upstream token/);
  assert.throws(() => buildDynamicProxyBaseUrl('https://provider.example.com/v1', 'http://127.0.0.1:1028/prefix'), /must be an origin/);
});
