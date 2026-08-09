import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPromptPrism, parseUpstreamUrl } from '../../src/proxy.js';

const listen = (server: http.Server): Promise<number> => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
const close = (server: http.Server): Promise<void> => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

interface HttpResult {
  status: number | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
  times: number[];
}

function request({ port, pathname = '/v1/messages', headers = {}, body }: { port: number; pathname?: string; headers?: http.OutgoingHttpHeaders; body?: string }): Promise<HttpResult> {
  return new Promise<HttpResult>((resolve, reject) => {
    const started = Date.now();
    const chunks: Buffer[] = [];
    const times: number[] = [];
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: body ? 'POST' : 'GET', headers }, (res) => {
      res.on('data', (chunk) => { chunks.push(chunk); times.push(Date.now() - started); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString(), times }));
    });
    req.on('error', reject);
    if (body) req.end(body); else req.end();
  });
}

test('proxy uses the configured endpoint, preserves auth, streams SSE, captures asynchronously, and serves APIs', async (t) => {
  let seen: { url: string | undefined; key: string | string[] | undefined; body: string } | undefined;
  const upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen = { url: req.url, key: req.headers['x-api-key'], body: Buffer.concat(chunks).toString() };
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-upstream': 'yes' });
      res.write('event: message_start\ndata: {"message":{"usage":{"input_tokens":12,"cache_read_input_tokens":4}}}\n\n');
      setTimeout(() => res.end('event: message_delta\ndata: {"usage":{"output_tokens":2}}\n\n'), 90);
    });
  });
  const upstreamPort = await listen(upstream);
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-proxy-'));
  const prism = await createPromptPrism({ upstreamUrl: `http://127.0.0.1:${upstreamPort}/api/v1/messages?configured=1`, dataDir: dir });
  assert.equal(prism.upstreamUrl.href, `http://127.0.0.1:${upstreamPort}/api/v1/messages?configured=1`);
  const proxyPort = await listen(prism.server);
  t.after(async () => { await close(prism.server); await close(upstream); });

  const body = JSON.stringify({ model: 'claude-test', messages: [{ role: 'user', content: 'hello' }] });
  const result = await request({ port: proxyPort, pathname: '/v1/messages?beta=1', headers: { 'content-type': 'application/json', 'x-api-key': 'top-secret', 'content-length': Buffer.byteLength(body) }, body });
  assert.equal(result.status, 200);
  assert.equal(result.headers['x-upstream'], 'yes');
  assert.equal(seen?.url, '/api/v1/messages?configured=1');
  assert.equal(seen?.key, 'top-secret');
  assert.ok((result.times[0] ?? Number.POSITIVE_INFINITY) < 70, `first streamed chunk arrived after ${result.times[0]}ms`);
  assert.ok((result.times.at(-1) ?? 0) >= 80);

  await prism.store.pending;
  assert.equal(prism.store.captures.length, 1);
  const firstCapture = prism.store.captures[0];
  assert.ok(firstCapture);
  const stored = await prism.store.readCapture(firstCapture.id);
  assert.ok(stored?.request);
  assert.equal(stored.request.headers['x-api-key'], '[REDACTED]');
  assert.ok(!JSON.stringify(stored.request.headers).includes('top-secret'));
  assert.equal(stored.usage.cache_read_input_tokens, 4);
  assert.equal(firstCapture.response_status, 200);
  assert.equal(firstCapture.upstream_host, `127.0.0.1:${upstreamPort}`);
  assert.equal(stored.upstream_host, `127.0.0.1:${upstreamPort}`);

  const logs = await request({ port: proxyPort, pathname: '/_pp/api/logs' });
  const parsedLogs = JSON.parse(logs.body);
  assert.equal(parsedLogs[0].model, 'claude-test');
  assert.equal(parsedLogs[0].response_status, 200);
  assert.equal(parsedLogs[0].upstream_host, `127.0.0.1:${upstreamPort}`);
  assert.equal(parsedLogs[0].analysis.actual_cache_read_tokens, 4);
  assert.equal('messages' in parsedLogs[0], false, 'list responses should not repeat complete prompts');
  assert.equal('diff' in parsedLogs[0].analysis, false, 'list responses should not include detail diff data');
  const detail = await request({ port: proxyPort, pathname: `/_pp/api/diff/${parsedLogs[0].id}` });
  assert.equal(JSON.parse(detail.body).id, parsedLogs[0].id);
  const raw = await request({ port: proxyPort, pathname: `/_pp/api/raw/${parsedLogs[0].id}` });
  assert.equal(raw.status, 200);
  const parsedRaw = JSON.parse(raw.body);
  assert.equal(parsedRaw.request.method, 'POST');
  assert.equal(parsedRaw.request.url, '/v1/messages?beta=1');
  assert.equal(parsedRaw.request.headers['x-api-key'], '[REDACTED]');
  assert.equal(parsedRaw.request.body, body);
  assert.equal(parsedRaw.response.status, 200);
  assert.equal(parsedRaw.response.headers['x-upstream'], 'yes');
  assert.match(parsedRaw.response.body, /message_start/);
  const missingRaw = await request({ port: proxyPort, pathname: '/_pp/api/raw/missing-capture' });
  assert.equal(missingRaw.status, 404);

  await prism.store.writeCapture({
    id: 'legacy-capture', timestamp: '2026-08-09T00:00:00.000Z', token_hash: 'legacy',
    model: 'legacy-model', messages: [], usage: {}
  });
  const legacyRaw = await request({ port: proxyPort, pathname: '/_pp/api/raw/legacy-capture' });
  assert.deepEqual(JSON.parse(legacyRaw.body), { request: null, response: null });

  const dashboard = await request({ port: proxyPort, pathname: '/_pp/' });
  assert.equal(dashboard.status, 200);
  assert.match(String(dashboard.headers['content-type']), /text\/html/);
  assert.match(dashboard.body, /\/_pp\/brand\/favicon-32\.png/);
  assert.match(dashboard.body, /\/_pp\/brand\/favicon\.ico\?v=2/);
  const assetPath = dashboard.body.match(/src="([^"]+\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(assetPath, 'dashboard HTML should reference its compiled React asset');
  const asset = await request({ port: proxyPort, pathname: assetPath });
  assert.equal(asset.status, 200);
  assert.match(String(asset.headers['content-type']), /javascript/);
  const logo = await request({ port: proxyPort, pathname: '/_pp/brand/logo-mark.png' });
  assert.equal(logo.status, 200);
  assert.match(String(logo.headers['content-type']), /image\/png/);
  const rootFavicon = await request({ port: proxyPort, pathname: '/favicon.ico' });
  assert.equal(rootFavicon.status, 200);
  assert.match(String(rootFavicon.headers['content-type']), /image\/x-icon/);
  const unsafeBrandPath = await request({ port: proxyPort, pathname: '/_pp/brand/%2e%2e%2f.env' });
  assert.equal(unsafeBrandPath.status, 404);
  assert.match(await readFile(path.join(dir, 'captures.jsonl'), 'utf8'), /claude-test/);
});

test('Prism validates and preserves complete upstream URLs', async () => {
  assert.equal(parseUpstreamUrl('https://provider.example.com/step_plan/v1/messages?region=cn').href, 'https://provider.example.com/step_plan/v1/messages?region=cn');
  assert.throws(() => parseUpstreamUrl('not-a-url'), /valid absolute URL/);
  assert.throws(() => parseUpstreamUrl('ftp://provider.example.com'), /http or https/);
  assert.throws(() => parseUpstreamUrl('https://provider.example.com/v1/messages#fragment'), /fragment/);
});
