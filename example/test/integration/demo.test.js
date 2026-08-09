import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_DEMO_BASE_URL, messagesUrl, parseBaseUrl, startDemo } from '../../server.js';
import { createPromptPrism } from 'prompt-prism';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

function request({ port, pathname, method = 'GET', body }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const times = [];
    const started = Date.now();
    const req = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}
    }, (response) => {
      response.on('data', (chunk) => { chunks.push(chunk); times.push(Date.now() - started); });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8'), times }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function unusedPort() {
  const server = http.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

test('Demo Agent streams through Prism to the exact upstream URL and is captured', async (t) => {
  let modelRequest;
  const modelService = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      modelRequest = {
        url: request.url,
        token: request.headers['x-api-key'],
        body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
      };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('event: message_start\ndata: {"type":"message_start"}\n\n');
      setTimeout(() => response.end('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Agent reply"}}\n\n'), 40);
    });
  });
  const modelPort = await listen(modelService);
  const dataDir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-demo-'));
  const prism = await createPromptPrism({
    upstreamUrl: `http://127.0.0.1:${modelPort}/tenant/demo/v1/messages`,
    dataDir
  });
  const prismPort = await listen(prism.server);
  const demo = await startDemo({
    baseUrl: `http://127.0.0.1:${prismPort}`,
    providerToken: 'demo-secret',
    model: 'demo-test-model',
    demoPort: 0
  });
  t.after(async () => { await demo.close(); await close(prism.server); await close(modelService); });

  const page = await request({ port: demo.demoPort, pathname: '/' });
  assert.equal(page.status, 200);
  assert.match(page.body, /Prompt Prism Agent Demo/);
  assert.match(page.body, /Message the agent/);
  assert.match(page.body, /\/brand\/logo-mark\.png/);
  assert.match(page.body, /\/brand\/favicon-32\.png/);
  assert.doesNotMatch(page.body, /dashboard/i);

  const logo = await request({ port: demo.demoPort, pathname: '/brand/logo-mark.png' });
  assert.equal(logo.status, 200);
  assert.match(logo.headers['content-type'], /image\/png/);
  const unsafeBrandPath = await request({ port: demo.demoPort, pathname: '/brand/%2e%2e%2f.env' });
  assert.equal(unsafeBrandPath.status, 404);

  const body = JSON.stringify({
    model: 'browser-model-must-be-ignored',
    baseUrl: 'http://attacker.invalid',
    providerToken: 'attacker-token',
    messages: [{ role: 'user', content: 'Hello agent' }]
  });
  const chat = await request({ port: demo.demoPort, pathname: '/api/chat', method: 'POST', body });
  assert.equal(chat.status, 200);
  assert.match(chat.headers['content-type'], /text\/event-stream/);
  assert.match(chat.body, /Agent reply/);
  assert.ok(chat.times.length >= 2, 'SSE should arrive in more than one downstream chunk');
  assert.ok(chat.times.at(-1) - chat.times[0] >= 25, 'the first SSE chunk must not wait for stream completion');
  assert.equal(modelRequest.url, '/tenant/demo/v1/messages');
  assert.equal(modelRequest.token, 'demo-secret');
  assert.equal(modelRequest.body.model, 'demo-test-model');
  assert.equal(modelRequest.body.stream, true);
  assert.deepEqual(modelRequest.body.messages, [{ role: 'user', content: 'Hello agent' }]);

  await new Promise((resolve) => setImmediate(resolve));
  await prism.store.pending;
  assert.equal(prism.store.captures.length, 1);
  assert.equal(prism.store.captures[0].model, 'demo-test-model');
  assert.ok(prism.analyzer.analyses.has(prism.store.captures[0].id));

  const config = JSON.parse((await request({ port: demo.demoPort, pathname: '/api/config' })).body);
  assert.deepEqual(config, { model: 'demo-test-model' });
});

test('Demo defaults to local Prompt Prism and requires token and model configuration', async () => {
  assert.equal(DEFAULT_DEMO_BASE_URL, 'http://127.0.0.1:8787');
  assert.equal(messagesUrl(parseBaseUrl('https://example.com/prism/')).href, 'https://example.com/prism/v1/messages');
  const example = await readFile(new URL('../../.env.example', import.meta.url), 'utf8');
  assert.match(example, /^DEMO_BASE_URL=http:\/\/127\.0\.0\.1:8787$/m);
  assert.doesNotMatch(example, /^DEMO_BASE_URL=.*\/v1/m);
  const demo = await startDemo({ providerToken: 'token', model: 'model', demoPort: 0 });
  await demo.close();
  await assert.rejects(startDemo({ baseUrl: 'http://localhost', model: 'model', demoPort: 0 }), /Missing DEMO_MODEL_PROVIDER_TOKEN/);
  await assert.rejects(startDemo({ baseUrl: 'http://localhost', providerToken: 'token', demoPort: 0 }), /Missing DEMO_AGENT_MODEL/);
});

test('Demo rejects invalid Prism Base URLs and paths containing /v1', async () => {
  await assert.rejects(startDemo({ baseUrl: 'not-a-url', providerToken: 'token', model: 'model', demoPort: 0 }), /valid absolute URL/);
  await assert.rejects(startDemo({ baseUrl: 'ftp://example.com', providerToken: 'token', model: 'model', demoPort: 0 }), /http or https/);
  await assert.rejects(startDemo({ baseUrl: 'https://example.com/v1', providerToken: 'token', model: 'model', demoPort: 0 }), /base URL without \/v1/);
  await assert.rejects(startDemo({ baseUrl: 'https://example.com/v1/messages', providerToken: 'token', model: 'model', demoPort: 0 }), /base URL without \/v1/);
});

test('Demo returns 502 when Prompt Prism is unreachable', async (t) => {
  const port = await unusedPort();
  const demo = await startDemo({ baseUrl: `http://127.0.0.1:${port}`, providerToken: 'token', model: 'demo-test-model', demoPort: 0 });
  t.after(() => demo.close());
  const result = await request({ port: demo.demoPort, pathname: '/api/chat', method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }) });
  assert.equal(result.status, 502);
  assert.match(JSON.parse(result.body).error, /Prompt Prism request failed/);
});

test('Demo preserves a non-2xx response from Prompt Prism', async (t) => {
  const analysisService = http.createServer((request, response) => {
    request.resume();
    response.writeHead(429, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'rate limited' }));
  });
  const analysisPort = await listen(analysisService);
  const demo = await startDemo({ baseUrl: `http://127.0.0.1:${analysisPort}`, providerToken: 'token', model: 'demo-test-model', demoPort: 0 });
  t.after(async () => { await demo.close(); await close(analysisService); });
  const result = await request({ port: demo.demoPort, pathname: '/api/chat', method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }) });
  assert.equal(result.status, 429);
  assert.deepEqual(JSON.parse(result.body), { error: 'rate limited' });
});
