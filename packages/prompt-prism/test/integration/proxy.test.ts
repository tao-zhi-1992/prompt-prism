import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createPromptPrism, parseUpstreamBaseUrl, parseUpstreamUrl } from '../../src/proxy.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../../bin/pp.js', import.meta.url));

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
  let seen: { url: string | undefined; key: string | string[] | undefined; traceId: string | string[] | undefined; body: string } | undefined;
  const upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen = { url: req.url, key: req.headers['x-api-key'], traceId: req.headers['x-prompt-prism-trace-id'], body: Buffer.concat(chunks).toString() };
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-upstream': 'yes' });
      res.write([
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"msg_proxy","role":"assistant","model":"claude-test","content":[],"usage":{"input_tokens":12,"cache_read_input_tokens":4}}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}',
        '',
        '',
      ].join('\n'));
      setTimeout(() => res.end('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'), 90);
    });
  });
  const upstreamPort = await listen(upstream);
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-proxy-'));
  const prism = await createPromptPrism({ upstreamUrl: `http://127.0.0.1:${upstreamPort}/api/v1/messages?configured=1`, dataDir: dir });
  assert.equal(prism.upstreamUrl.href, `http://127.0.0.1:${upstreamPort}/api/v1/messages?configured=1`);
  const proxyPort = await listen(prism.server);
  t.after(async () => { await close(prism.server); await close(upstream); });

  const body = JSON.stringify({ model: 'claude-test', messages: [{ role: 'user', content: 'hello' }] });
  const result = await request({ port: proxyPort, pathname: '/v1/messages?beta=1', headers: { 'content-type': 'application/json', 'x-api-key': 'top-secret', 'x-prompt-prism-trace-id': 'agent.session:one', 'content-length': Buffer.byteLength(body) }, body });
  assert.equal(result.status, 200);
  assert.equal(result.headers['x-upstream'], 'yes');
  assert.equal(seen?.url, '/api/v1/messages?configured=1');
  assert.equal(seen?.key, 'top-secret');
  assert.equal(seen?.traceId, undefined);
  assert.ok((result.times[0] ?? Number.POSITIVE_INFINITY) < 70, `first streamed chunk arrived after ${result.times[0]}ms`);
  assert.ok((result.times.at(-1) ?? 0) >= 80);

  await prism.store.pending;
  assert.equal(prism.store.captures.length, 1);
  const firstCapture = prism.store.captures[0];
  assert.ok(firstCapture);
  const stored = await prism.store.readCapture(firstCapture.id);
  assert.ok(stored?.request);
  assert.equal(stored.request.headers['x-api-key'], '[REDACTED]');
  assert.equal(stored.request.headers['x-prompt-prism-trace-id'], 'agent.session:one');
  assert.ok(!JSON.stringify(stored.request.headers).includes('top-secret'));
  assert.equal(stored.usage.cache_read_input_tokens, 4);
  assert.equal(firstCapture.response_status, 200);
  assert.equal(firstCapture.upstream_host, `127.0.0.1:${upstreamPort}`);
  assert.equal(firstCapture.trace_id, 'agent.session:one');
  assert.equal(stored.upstream_host, `127.0.0.1:${upstreamPort}`);
  assert.equal(stored.adapter_id, 'anthropic-messages');
  assert.equal(stored.trace_id, 'agent.session:one');
  assert.equal(stored.timing?.started_at, firstCapture.timing?.started_at);
  assert.equal(stored.timing?.completed_at, stored.timestamp);
  assert.ok((stored.timing?.duration_ms ?? 0) >= 80);
  assert.ok((stored.timing?.time_to_headers_ms ?? Number.POSITIVE_INFINITY) <= (stored.timing?.time_to_first_byte_ms ?? -1));
  assert.ok((stored.timing?.time_to_first_byte_ms ?? Number.POSITIVE_INFINITY) < 70);
  assert.deepEqual(stored.prompt_input?.sections.map(({ id }) => id), ['messages', 'system', 'tools', 'options']);
  assert.equal(stored.model_output?.id, 'msg_proxy');
  assert.equal(stored.model_output?.stop_reason, 'end_turn');
  assert.deepEqual(stored.model_output?.content, [{ type: 'text', text: 'hello' }]);

  const logs = await request({ port: proxyPort, pathname: '/_pp/api/logs' });
  const parsedLogs = JSON.parse(logs.body);
  assert.equal(parsedLogs[0].model, 'claude-test');
  assert.equal(parsedLogs[0].response_status, 200);
  assert.equal(parsedLogs[0].upstream_host, `127.0.0.1:${upstreamPort}`);
  assert.equal(parsedLogs[0].trace_id, 'agent.session:one');
  assert.ok(parsedLogs[0].timing.duration_ms >= 80);
  assert.equal(parsedLogs[0].analysis.actual_cache_read_tokens, 4);
  assert.equal('messages' in parsedLogs[0], false, 'list responses should not repeat complete prompts');
  assert.equal('prompt_input' in parsedLogs[0], false, 'list responses should not repeat normalized input');
  assert.equal('model_output' in parsedLogs[0], false, 'list responses should not include normalized output');
  assert.equal('diff' in parsedLogs[0].analysis, false, 'list responses should not include detail diff data');
  assert.equal('sections' in parsedLogs[0].analysis, false, 'list responses should not include section diff data');
  const detail = await request({ port: proxyPort, pathname: `/_pp/api/input-diff/${parsedLogs[0].id}` });
  const parsedDetail = JSON.parse(detail.body);
  assert.equal(parsedDetail.id, parsedLogs[0].id);
  assert.deepEqual(parsedDetail.sections.map(({ id }: { id: string }) => id), ['messages', 'system', 'tools', 'options']);
  const removedDiffRoute = await request({ port: proxyPort, pathname: `/_pp/api/diff/${parsedLogs[0].id}` });
  assert.equal(removedDiffRoute.status, 404);
  const raw = await request({ port: proxyPort, pathname: `/_pp/api/raw/${parsedLogs[0].id}` });
  assert.equal(raw.status, 200);
  const parsedRaw = JSON.parse(raw.body);
  assert.equal(parsedRaw.request.method, 'POST');
  assert.equal(parsedRaw.request.url, '/v1/messages?beta=1');
  assert.equal(parsedRaw.request.target_url, `http://127.0.0.1:${upstreamPort}/api/v1/messages?configured=1`);
  assert.equal(parsedRaw.request.headers['x-api-key'], '[REDACTED]');
  assert.equal(parsedRaw.request.body, body);
  assert.equal(parsedRaw.response.status, 200);
  assert.equal(parsedRaw.response.headers['x-upstream'], 'yes');
  assert.match(parsedRaw.response.body, /message_start/);
  const normalizedOutput = await request({ port: proxyPort, pathname: `/_pp/api/output/${parsedLogs[0].id}` });
  assert.equal(normalizedOutput.status, 200);
  assert.deepEqual(JSON.parse(normalizedOutput.body).output.content, [{ type: 'text', text: 'hello' }]);
  const trace = await request({ port: proxyPort, pathname: `/_pp/api/trace/${parsedLogs[0].id}` });
  assert.equal(trace.status, 200);
  const parsedTrace = JSON.parse(trace.body);
  assert.equal(parsedTrace.source, 'explicit');
  assert.equal(parsedTrace.id, 'agent.session:one');
  assert.equal(parsedTrace.calls.length, 1);
  assert.deepEqual(parsedTrace.calls[0].input_delta, [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]);
  const insightRuns = await request({ port: proxyPort, pathname: '/_pp/api/insights/runs?limit=1' });
  assert.equal(insightRuns.status, 200);
  assert.equal(JSON.parse(insightRuns.body).runs[0].run_id, firstCapture.id);
  const insightReport = await request({ port: proxyPort, pathname: `/_pp/api/insights/report/${firstCapture.id}` });
  assert.equal(insightReport.status, 200);
  assert.equal(JSON.parse(insightReport.body).run.calls, 1);
  assert.equal(JSON.stringify(JSON.parse(insightReport.body)).includes('hello'), false, 'insight reports should not expose prompt content');
  const insightEvidence = await request({ port: proxyPort, pathname: `/_pp/api/insights/evidence/${firstCapture.id}?section=messages&max_bytes=1024` });
  assert.equal(insightEvidence.status, 200);
  assert.match(JSON.parse(insightEvidence.body).content, /hello/);
  const insightComparison = await request({ port: proxyPort, pathname: `/_pp/api/insights/compare?baseline=${firstCapture.id}&candidate=${firstCapture.id}` });
  assert.equal(insightComparison.status, 200);
  assert.equal(JSON.parse(insightComparison.body).metrics.calls.absolute, 0);
  const cliReport = await run(process.execPath, [cli, 'insights', 'report', firstCapture.id, '--prism-url', `http://127.0.0.1:${proxyPort}`, '--json']);
  assert.equal(JSON.parse(cliReport.stdout).run.run_id, firstCapture.id);
  const cliCompare = await run(process.execPath, [cli, 'insights', 'compare', firstCapture.id, firstCapture.id, '--prism-url', `http://127.0.0.1:${proxyPort}`, '--json']);
  assert.equal(JSON.parse(cliCompare.stdout).metrics.calls.absolute, 0);
  const missingRaw = await request({ port: proxyPort, pathname: '/_pp/api/raw/missing-capture' });
  assert.equal(missingRaw.status, 404);

  const invalidTraceBody = JSON.stringify({ model: 'claude-test', messages: [{ role: 'user', content: 'invalid trace' }] });
  await request({ port: proxyPort, headers: { 'content-type': 'application/json', 'x-api-key': 'top-secret', 'x-prompt-prism-trace-id': 'invalid trace id', 'content-length': Buffer.byteLength(invalidTraceBody) }, body: invalidTraceBody });
  await prism.store.pending;
  assert.equal(prism.store.captures.find((capture) => capture.id !== firstCapture.id)?.trace_id, undefined);

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

test('OpenAI chat SSE flows through every normalized dashboard and insights API', async (t) => {
  let seen: { url?: string; authorization?: string; traceId?: string; body: string } | undefined;
  const upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen = {
        url: req.url,
        authorization: req.headers.authorization,
        traceId: req.headers['x-prompt-prism-trace-id'] as string | undefined,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"id":"chatcmpl_proxy","object":"chat.completion.chunk","model":"openai-test","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"inspect ","content":"hello "},"finish_reason":null}]}\n\n');
      setTimeout(() => res.end([
        'data: {"id":"chatcmpl_proxy","object":"chat.completion.chunk","model":"openai-test","choices":[{"index":0,"delta":{"reasoning_content":"first","content":"world","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read","arguments":"{\\"path\\":\\"a.ts\\"}"}}]},"finish_reason":"tool_calls"}]}',
        '',
        'data: {"id":"chatcmpl_proxy","object":"chat.completion.chunk","model":"openai-test","choices":[],"usage":{"prompt_tokens":30,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":20}}}',
        '',
        'data: [DONE]',
        '',
      ].join('\n')), 50);
    });
  });
  const upstreamPort = await listen(upstream);
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-openai-'));
  const prism = await createPromptPrism({
    upstreamUrl: `http://127.0.0.1:${upstreamPort}/tenant/openai/v1/chat/completions?region=test`,
    apiFormat: 'openai',
    dataDir: dir,
  });
  const proxyPort = await listen(prism.server);
  t.after(async () => { await close(prism.server); await close(upstream); });

  const body = JSON.stringify({
    model: 'openai-test', stream: true, stream_options: { include_usage: true },
    messages: [{ role: 'system', content: 'Be concise' }, { role: 'user', content: 'Inspect this' }],
    tools: [{ type: 'function', function: { name: 'read', parameters: { type: 'object' } } }],
  });
  const result = await request({
    port: proxyPort,
    pathname: '/v1/chat/completions?client=ignored',
    headers: {
      'content-type': 'application/json', authorization: 'Bearer openai-secret',
      'x-prompt-prism-trace-id': 'openai.trace:one', 'content-length': Buffer.byteLength(body),
    },
    body,
  });
  assert.equal(result.status, 200);
  assert.equal(seen?.url, '/tenant/openai/v1/chat/completions?region=test');
  assert.equal(seen?.authorization, 'Bearer openai-secret');
  assert.equal(seen?.traceId, undefined);
  assert.equal(seen?.body, body);
  assert.ok(result.times.length >= 2);
  assert.ok((result.times.at(-1) ?? 0) - (result.times[0] ?? 0) >= 35, 'SSE chunks should not be buffered until completion');

  await prism.store.pending;
  const entry = prism.store.captures[0];
  assert.ok(entry);
  const capture = await prism.store.readCapture(entry.id);
  assert.equal(capture?.adapter_id, 'openai-chat-completions');
  assert.equal(capture?.request?.headers.authorization, '[REDACTED]');
  assert.deepEqual(capture?.usage, { input_tokens: 10, output_tokens: 7, cache_read_input_tokens: 20 });
  assert.deepEqual(capture?.prompt_input?.sections.map(({ id }) => id), ['messages', 'system', 'tools', 'options']);
  assert.deepEqual(capture?.prompt_input?.conversation, [{ role: 'user', content: [{ type: 'text', text: 'Inspect this' }] }]);
  assert.deepEqual(capture?.model_output?.content, [
    { type: 'reasoning', text: 'inspect first' },
    { type: 'text', text: 'hello world' },
    { type: 'tool_call', id: 'call_1', name: 'read', input: { path: 'a.ts' } },
  ]);

  const inputDiff = JSON.parse((await request({ port: proxyPort, pathname: `/_pp/api/input-diff/${entry.id}` })).body);
  assert.deepEqual(inputDiff.sections.map(({ id }: { id: string }) => id), ['messages', 'system', 'tools', 'options']);
  const output = JSON.parse((await request({ port: proxyPort, pathname: `/_pp/api/output/${entry.id}` })).body);
  assert.equal(output.output.adapter_id, 'openai-chat-completions');
  assert.equal(output.output.stop_reason, 'tool_calls');
  const trace = JSON.parse((await request({ port: proxyPort, pathname: `/_pp/api/trace/${entry.id}` })).body);
  assert.equal(trace.source, 'explicit');
  assert.equal(trace.calls[0].input_delta[0].content[0].text, 'Inspect this');
  assert.equal(trace.calls[0].output.content[2].name, 'read');
  const raw = JSON.parse((await request({ port: proxyPort, pathname: `/_pp/api/raw/${entry.id}` })).body);
  assert.equal(raw.request.url, '/v1/chat/completions?client=ignored');
  assert.equal(raw.request.target_url, `http://127.0.0.1:${upstreamPort}/tenant/openai/v1/chat/completions?region=test`);
  assert.equal(JSON.parse(raw.response.body.split('\n').find((line: string) => line.startsWith('data: {'))!.slice(6)).object, 'chat.completion.chunk');
  const insights = JSON.parse((await request({ port: proxyPort, pathname: `/_pp/api/insights/report/${entry.id}` })).body);
  assert.equal(insights.run.tokens.uncached_input_tokens, 10);
  assert.equal(insights.run.tokens.cache_read_input_tokens, 20);
  assert.equal(insights.run.tokens.input_total_tokens, 30);
  assert.equal(insights.tools.calls, 1);

  assert.ok(capture);
  const historicalCapture = { ...capture };
  delete historicalCapture.model_output;
  await writeFile(path.join(dir, entry.file_ref), JSON.stringify(historicalCapture));
  const historicalOutput = JSON.parse((await request({ port: proxyPort, pathname: `/_pp/api/output/${entry.id}` })).body);
  assert.equal(historicalOutput.output.adapter_id, 'openai-chat-completions');
  assert.equal(historicalOutput.output.content[2].name, 'read');
});

test('Prism validates and preserves complete upstream URLs', async () => {
  assert.equal(parseUpstreamUrl('https://provider.example.com/step_plan/v1/messages?region=cn').href, 'https://provider.example.com/step_plan/v1/messages?region=cn');
  assert.throws(() => parseUpstreamUrl('not-a-url'), /valid absolute URL/);
  assert.throws(() => parseUpstreamUrl('ftp://provider.example.com'), /http or https/);
  assert.throws(() => parseUpstreamUrl('https://provider.example.com/v1/messages#fragment'), /fragment/);
});

test('base URL mode derives provider endpoints and Auto locks the request protocol', async (t) => {
  const seen: string[] = [];
  const upstream = http.createServer((req, res) => {
    seen.push(req.url ?? '');
    req.resume();
    req.on('end', () => {
      const body = JSON.stringify({ id: 'chatcmpl_base', object: 'chat.completion', model: 'deepseek-test', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1 } });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
    });
  });
  const upstreamPort = await listen(upstream);
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-base-'));
  const prism = await createPromptPrism({ upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/tenant`, dataDir: dir });
  const proxyPort = await listen(prism.server);
  t.after(async () => { await close(prism.server); await close(upstream); });

  assert.equal(prism.upstreamMode, 'base');
  assert.equal(prism.apiFormat.resolved, null);
  const before = JSON.parse((await request({ port: proxyPort, pathname: '/_pp/api/config' })).body);
  assert.deepEqual(before.api_format, { mode: 'auto', configured: 'auto', resolved: null, source: null });

  const body = JSON.stringify({ model: 'deepseek-test', messages: [{ role: 'user', content: 'hello' }] });
  const result = await request({ port: proxyPort, pathname: '/v1/chat/completions?region=cn', headers: { 'content-type': 'application/json', authorization: 'Bearer token' }, body });
  assert.equal(result.status, 200);
  assert.deepEqual(seen, ['/tenant/v1/chat/completions?region=cn']);
  const legacyResult = await request({ port: proxyPort, pathname: '/chat/completions?region=legacy', headers: { 'content-type': 'application/json', authorization: 'Bearer token' }, body });
  assert.equal(legacyResult.status, 200);
  assert.deepEqual(seen, ['/tenant/v1/chat/completions?region=cn', '/tenant/chat/completions?region=legacy']);
  await prism.store.pending;
  assert.equal(prism.store.captures[0]?.adapter_id, 'openai-chat-completions');
  assert.equal(prism.apiFormat.resolved, 'openai-chat-completions');
  assert.equal(prism.apiFormat.source, 'request-path');
});

test('unrecognized base routes remain transparent and create Raw-only captures', async (t) => {
  let seen = '';
  const upstream = http.createServer((req, res) => {
    seen = req.url ?? '';
    req.resume();
    req.on('end', () => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('provider extension'); });
  });
  const upstreamPort = await listen(upstream);
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-unresolved-'));
  const prism = await createPromptPrism({ upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/gateway`, dataDir: dir });
  const proxyPort = await listen(prism.server);
  t.after(async () => { await close(prism.server); await close(upstream); });

  const body = JSON.stringify({ model: 'ambiguous-model', messages: [{ role: 'user', content: 'hello' }] });
  assert.equal((await request({ port: proxyPort, pathname: '/custom/generate?x=1', headers: { 'content-type': 'application/json' }, body })).body, 'provider extension');
  assert.equal(seen, '/gateway/custom/generate?x=1');
  await prism.store.pending;
  const entry = prism.store.captures[0];
  assert.ok(entry);
  const capture = await prism.store.readCapture(entry.id);
  assert.equal(capture?.adapter_id, 'unresolved');
  assert.equal(capture?.model, 'ambiguous-model');
  assert.equal(capture?.prompt_input, undefined);
  assert.equal(capture?.request?.body, body);
  assert.equal((await request({ port: proxyPort, pathname: `/_pp/api/input-diff/${entry.id}` })).status, 404);
});

test('Prism validates provider-style Base URLs', () => {
  assert.equal(parseUpstreamBaseUrl('https://api.deepseek.com/').href, 'https://api.deepseek.com/');
  assert.equal(parseUpstreamBaseUrl('https://api.stepfun.com/step_plan/').href, 'https://api.stepfun.com/step_plan');
  assert.throws(() => parseUpstreamBaseUrl('https://api.deepseek.com/chat/completions'), /must not include an API endpoint/);
  assert.throws(() => parseUpstreamBaseUrl('https://api.example.com?tenant=one'), /must not contain a query/);
});

test('captures timing for non-streaming JSON responses', async (t) => {
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      setTimeout(() => {
        const body = JSON.stringify({ id: 'msg_json', type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 1 } });
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
        res.end(body);
      }, 20);
    });
  });
  const upstreamPort = await listen(upstream);
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-timing-'));
  const prism = await createPromptPrism({ upstreamUrl: `http://127.0.0.1:${upstreamPort}/v1/messages`, dataDir: dir });
  const proxyPort = await listen(prism.server);
  t.after(async () => { await close(prism.server); await close(upstream); });
  const body = JSON.stringify({ model: 'claude-test', messages: [{ role: 'user', content: 'hello' }] });
  await request({ port: proxyPort, headers: { 'content-type': 'application/json', 'x-api-key': 'secret', 'content-length': Buffer.byteLength(body) }, body });
  await prism.store.pending;
  const stored = await prism.store.readCapture(prism.store.captures[0]!.id);
  assert.ok((stored?.timing?.duration_ms ?? 0) >= 15);
  assert.ok((stored?.timing?.time_to_headers_ms ?? 0) >= 15);
  assert.ok((stored?.timing?.time_to_first_byte_ms ?? 0) >= (stored?.timing?.time_to_headers_ms ?? 0));
});
