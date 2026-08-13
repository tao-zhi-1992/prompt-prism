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
import { buildDynamicProxyBaseUrl, createPromptPrism, parseUpstreamBaseUrl, parseUpstreamUrl, startPromptPrism } from '../../src/index.js';
import { close, listen, request } from './helpers/http.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../../bin/pp.js', import.meta.url));

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
  assert.ok(prism.upstreamUrl);
  assert.equal(prism.upstreamUrl.href, `http://127.0.0.1:${upstreamPort}/api/v1/messages?configured=1`);
  const proxyPort = await listen(prism.server);
  t.after(async () => { await close(prism.server); await close(upstream); });

  const devtoolsProbe = await request({ port: proxyPort, pathname: '/.well-known/appspecific/com.chrome.devtools.json?source=devtools' });
  assert.equal(devtoolsProbe.status, 404);
  assert.equal(seen === undefined, true);
  assert.equal(prism.store.captures.length, 0);

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
  assert.equal(parsedLogs[0].trace_group_id, 'agent.session:one');
  assert.equal(parsedLogs[0].trace_group_source, 'explicit');
  assert.equal(parsedLogs[0].trace_group_index, 1);
  assert.ok(parsedLogs[0].timing.duration_ms >= 80);
  assert.equal(parsedLogs[0].analysis, null);
  assert.equal('messages' in parsedLogs[0], false, 'list responses should not repeat complete prompts');
  assert.equal('prompt_input' in parsedLogs[0], false, 'list responses should not repeat normalized input');
  assert.equal('model_output' in parsedLogs[0], false, 'list responses should not include normalized output');
  const detail = await request({ port: proxyPort, pathname: `/_pp/api/input-diff/${parsedLogs[0].id}` });
  const parsedDetail = JSON.parse(detail.body);
  assert.equal(parsedDetail.id, parsedLogs[0].id);
  assert.equal(parsedDetail.actual_cache_read_tokens, 4);
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

test('dynamic upstream paths route each capture independently and preserve the fixed fallback', async (t) => {
  const seen: Array<{ provider: string; url: string; host: string | undefined; body: string }> = [];
  const provider = (name: 'openai' | 'anthropic' | 'fixed') => http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      seen.push({ provider: name, url: req.url ?? '', host: req.headers.host, body: Buffer.concat(chunks).toString() });
      res.writeHead(200, { 'content-type': 'application/json' });
      if (name === 'openai') res.end(JSON.stringify({ id: 'chatcmpl_dynamic', object: 'chat.completion', choices: [{ message: { role: 'assistant', content: 'openai dynamic' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }));
      else res.end(JSON.stringify({ id: `msg_${name}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: `${name} dynamic` }], usage: { input_tokens: 4, output_tokens: 1 } }));
    });
  });
  const openai = provider('openai');
  const anthropic = provider('anthropic');
  const fixed = provider('fixed');
  const [openaiPort, anthropicPort, fixedPort] = await Promise.all([listen(openai), listen(anthropic), listen(fixed)]);
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-dynamic-'));
  const prism = await createPromptPrism({ upstreamBaseUrl: `http://127.0.0.1:${fixedPort}/fixed`, dataDir: dir });
  const proxyPort = await listen(prism.server);
  t.after(async () => { await close(prism.server); await Promise.all([close(openai), close(anthropic), close(fixed)]); });

  const generateBody = JSON.stringify({ upstream_base_url: `http://127.0.0.1:${openaiPort}/tenant/v1` });
  const generated = await request({
    port: proxyPort,
    pathname: '/_pp/api/proxy-url',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(generateBody) },
    body: generateBody,
  });
  assert.equal(generated.status, 200);
  const openaiPath = JSON.parse(generated.body).path as string;
  assert.equal(openaiPath, new URL(buildDynamicProxyBaseUrl(`http://127.0.0.1:${openaiPort}/tenant/v1`)).pathname);
  const anthropicPath = new URL(buildDynamicProxyBaseUrl(`http://127.0.0.1:${anthropicPort}/gateway`)).pathname;

  const openaiBody = JSON.stringify({ model: 'openai-dynamic', messages: [{ role: 'developer', content: 'dynamic' }] });
  const anthropicBody = JSON.stringify({ model: 'anthropic-dynamic', messages: [{ role: 'user', content: [{ type: 'text', text: 'dynamic' }] }], tools: [{ name: 'read', input_schema: { type: 'object' } }] });
  await request({ port: proxyPort, pathname: `${openaiPath}/chat/completions?region=cn`, headers: { authorization: 'Bearer secret', 'content-type': 'application/json', 'content-length': Buffer.byteLength(openaiBody) }, body: openaiBody });
  await request({ port: proxyPort, pathname: `${anthropicPath}/v1/messages`, headers: { 'x-api-key': 'secret', 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'content-length': Buffer.byteLength(anthropicBody) }, body: anthropicBody });
  await request({ port: proxyPort, pathname: '/v1/messages', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(anthropicBody) }, body: anthropicBody });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await prism.store.pending;

  assert.deepEqual(seen.map(({ provider, url }) => [provider, url]), [
    ['openai', '/tenant/v1/chat/completions?region=cn'],
    ['anthropic', '/gateway/v1/messages'],
    ['fixed', '/fixed/v1/messages'],
  ]);
  assert.equal(seen[0]?.host, `127.0.0.1:${openaiPort}`);
  assert.equal(seen[1]?.host, `127.0.0.1:${anthropicPort}`);
  assert.equal(prism.store.captures.length, 3);
  const captures = await Promise.all(prism.store.captures.map(({ id }) => prism.store.readCapture(id)));
  assert.deepEqual(captures.map((capture) => capture?.adapter_id), ['openai-chat-completions', 'anthropic-messages', 'anthropic-messages']);
  assert.deepEqual(captures.map((capture) => capture?.upstream_host), [`127.0.0.1:${openaiPort}`, `127.0.0.1:${anthropicPort}`, `127.0.0.1:${fixedPort}`]);
  assert.equal(captures[0]?.request?.url, `${openaiPath}/chat/completions?region=cn`);
  assert.equal(captures[0]?.request?.target_url, `http://127.0.0.1:${openaiPort}/tenant/v1/chat/completions?region=cn`);
  assert.equal(captures[0]?.model_output?.content[0]?.type, 'text');
  assert.equal(captures[1]?.prompt_input?.adapter_id, 'anthropic-messages');
});

test('dynamic complete upstream URLs forward directly without inferred endpoint paths', async (t) => {
  const seen: string[] = [];
  const upstream = http.createServer((request, response) => {
    seen.push(request.url ?? '');
    request.resume();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 'chatcmpl_exact', object: 'chat.completion', choices: [{ message: { role: 'assistant', content: 'exact' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  });
  const upstreamPort = await listen(upstream);
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-dynamic-exact-'));
  const prism = await createPromptPrism({ dataDir: dir });
  const proxyPort = await listen(prism.server);
  t.after(async () => { await close(prism.server); await close(upstream); });

  const upstreamUrl = `http://127.0.0.1:${upstreamPort}/tenant/v1/chat/completions`;
  const body = JSON.stringify({ model: 'exact', messages: [{ role: 'user', content: 'hello' }] });
  const generated = await request({
    port: proxyPort,
    pathname: '/_pp/api/proxy-url',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(JSON.stringify({ upstream_base_url: upstreamUrl })) },
    body: JSON.stringify({ upstream_base_url: upstreamUrl }),
  });
  assert.equal(generated.status, 200);
  const dynamicPath = JSON.parse(generated.body).path as string;
  const result = await request({
    port: proxyPort,
    pathname: dynamicPath,
    headers: { authorization: 'Bearer secret', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    body,
  });
  assert.equal(result.status, 200);

  const fragmentPath = new URL(buildDynamicProxyBaseUrl(`http://127.0.0.1:${upstreamPort}/anthropic/gateway`, `http://127.0.0.1:${proxyPort}`)).pathname;
  const fragmentResult = await request({
    port: proxyPort,
    pathname: `${fragmentPath}/custom/generate`,
    headers: { authorization: 'Bearer secret', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    body,
  });
  assert.equal(fragmentResult.status, 200);
  assert.deepEqual(seen, ['/tenant/v1/chat/completions', '/anthropic/gateway/custom/generate']);
});

test('dynamic upstream paths fail closed and require opt-in on non-loopback listeners', async (t) => {
  let upstreamCalls = 0;
  const upstream = http.createServer((req, res) => { upstreamCalls += 1; req.resume(); res.end('ok'); });
  const upstreamPort = await listen(upstream);
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-dynamic-security-'));
  const prism = await createPromptPrism({ upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}`, dataDir: dir });
  const proxyPort = await new Promise<number>((resolve) => prism.server.listen(0, '0.0.0.0', () => resolve((prism.server.address() as AddressInfo).port)));
  t.after(async () => { await close(prism.server); await close(upstream); });

  const route = new URL(buildDynamicProxyBaseUrl(`http://127.0.0.1:${upstreamPort}`)).pathname;
  assert.equal((await request({ port: proxyPort, pathname: `${route}/v1/messages` })).status, 403);
  assert.equal((await request({ port: proxyPort, pathname: '/_proxy/not-valid=/v1/messages' })).status, 403);
  assert.equal(upstreamCalls, 0);

  const allowedDir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-dynamic-security-allowed-'));
  const allowed = await createPromptPrism({ upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}`, allowRemoteDynamicUpstream: true, dataDir: allowedDir });
  const allowedPort = await new Promise<number>((resolve) => allowed.server.listen(0, '0.0.0.0', () => resolve((allowed.server.address() as AddressInfo).port)));
  t.after(() => close(allowed.server));
  assert.equal((await request({ port: allowedPort, pathname: '/_proxy/not-valid=/v1/messages' })).status, 400);
  const invalidBody = JSON.stringify({ upstream_base_url: 'https://provider.example.com/v1?secret=value' });
  const invalidGenerated = await request({ port: allowedPort, pathname: '/_pp/api/proxy-url', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(invalidBody) }, body: invalidBody });
  assert.equal(invalidGenerated.status, 400);
  assert.match(JSON.parse(invalidGenerated.body).error, /must not contain a query/);
  assert.equal((await request({ port: allowedPort, pathname: `${route}/health` })).status, 200);
  assert.equal(upstreamCalls, 1);
});

test('Auto detects and normalizes every capture independently in both protocol orders', async () => {
  const openaiRequest = JSON.stringify({
    model: 'openai-auto',
    messages: [{ role: 'developer', content: 'Use tools carefully' }, { role: 'user', content: 'OpenAI input' }],
    tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
  });
  const anthropicRequest = JSON.stringify({
    model: 'anthropic-auto', system: 'Use tools carefully',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Anthropic input' }] }],
    tools: [{ name: 'lookup', input_schema: { type: 'object' } }],
  });
  const openaiResponse = JSON.stringify({
    id: 'chatcmpl_auto', object: 'chat.completion', model: 'openai-auto',
    choices: [{ index: 0, message: { role: 'assistant', content: 'OpenAI output' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 3 } },
  });
  const anthropicResponse = JSON.stringify({
    id: 'msg_auto', type: 'message', role: 'assistant', model: 'anthropic-auto',
    content: [{ type: 'text', text: 'Anthropic output' }], stop_reason: 'end_turn',
    usage: { input_tokens: 8, output_tokens: 5, cache_read_input_tokens: 2 },
  });

  for (const order of [['openai', 'anthropic'], ['anthropic', 'openai']] as const) {
    const upstream = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        const body = req.url?.endsWith('/v1/messages') ? anthropicResponse : openaiResponse;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(body);
      });
    });
    const upstreamPort = await listen(upstream);
    const dir = await mkdtemp(path.join(tmpdir(), `prompt-prism-auto-${order[0]}-`));
    const prism = await createPromptPrism({ upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/gateway`, dataDir: dir });
    const proxyPort = await listen(prism.server);

    try {
      const before = JSON.parse((await request({ port: proxyPort, pathname: '/_pp/api/config' })).body);
      assert.deepEqual(before.api_format, { mode: 'auto', configured: 'auto', resolved: null, source: null });

      for (const protocol of order) {
        const body = protocol === 'openai' ? openaiRequest : anthropicRequest;
        const pathname = protocol === 'openai' ? '/v1/chat/completions' : '/v1/messages';
        const result = await request({
          port: proxyPort, pathname,
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, body,
        });
        assert.equal(result.status, 200);
      }
      await prism.store.pending;

      assert.equal(prism.store.captures.length, 2);
      for (let index = 0; index < order.length; index += 1) {
        const protocol = order[index];
        const entry = prism.store.captures[index];
        assert.ok(entry);
        const capture = await prism.store.readCapture(entry.id);
        assert.ok(capture);
        if (protocol === 'openai') {
          assert.equal(capture.adapter_id, 'openai-chat-completions');
          assert.equal(capture.messages[0]?.role, 'developer');
          assert.equal(capture.prompt_input?.adapter_id, 'openai-chat-completions');
          assert.deepEqual(capture.usage, { input_tokens: 7, output_tokens: 4, cache_read_input_tokens: 3 });
          assert.deepEqual(capture.model_output?.content, [{ type: 'text', text: 'OpenAI output' }]);
        } else {
          assert.equal(capture.adapter_id, 'anthropic-messages');
          assert.equal(capture.messages[0]?.role, 'user');
          assert.equal(capture.prompt_input?.adapter_id, 'anthropic-messages');
          assert.deepEqual(capture.usage, { input_tokens: 8, output_tokens: 5, cache_read_input_tokens: 2 });
          assert.deepEqual(capture.model_output?.content, [{ type: 'text', text: 'Anthropic output' }]);
        }
      }

      const after = JSON.parse((await request({ port: proxyPort, pathname: '/_pp/api/config' })).body);
      assert.deepEqual(after.api_format, { mode: 'auto', configured: 'auto', resolved: null, source: null });
      assert.deepEqual(prism.apiFormat, after.api_format);
    } finally {
      await close(prism.server);
      await close(upstream);
    }
  }
});

test('Auto request priority and Raw captures do not influence later captures', async (t) => {
  const anthropicBody = JSON.stringify({
    model: 'anthropic-conflict', messages: [{ role: 'user', content: 'hello' }],
    tools: [{ name: 'lookup', input_schema: { type: 'object' } }],
  });
  const anthropicResponse = JSON.stringify({
    id: 'msg_conflict', type: 'message', role: 'assistant', model: 'anthropic-conflict',
    content: [{ type: 'text', text: 'anthropic response' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 2 },
  });
  const openaiBody = JSON.stringify({
    model: 'openai-after-raw', messages: [{ role: 'tool', tool_call_id: 'call_1', content: 'result' }],
  });
  const openaiResponse = JSON.stringify({
    id: 'chatcmpl_after_raw', object: 'chat.completion', model: 'openai-after-raw',
    choices: [{ index: 0, message: { role: 'assistant', content: 'still detected' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 4, completion_tokens: 1 },
  });
  const responsesBody = JSON.stringify({ model: 'responses-model', input: 'hello' });
  const responsesResponse = JSON.stringify({ id: 'resp_1', object: 'response', output: [] });
  const ambiguousBody = JSON.stringify({ model: 'custom-model', prompt: 'raw input' });

  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.url === '/gateway/v1/responses') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(responsesResponse);
      } else if (req.url === '/gateway/custom/generate') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('raw provider extension');
      } else if (req.url === '/gateway/v1/chat/completions') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(openaiResponse);
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(anthropicResponse);
      }
    });
  });
  const upstreamPort = await listen(upstream);
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-auto-isolation-'));
  const prism = await createPromptPrism({ upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/gateway`, dataDir: dir });
  const proxyPort = await listen(prism.server);
  t.after(async () => { await close(prism.server); await close(upstream); });

  for (const item of [
    { pathname: '/conflict/chat/completions', body: anthropicBody },
    { pathname: '/v1/messages', body: anthropicBody },
    { pathname: '/v1/responses', body: responsesBody },
    { pathname: '/custom/generate', body: ambiguousBody },
    { pathname: '/v1/chat/completions', body: openaiBody },
  ]) {
    await request({ port: proxyPort, ...item, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(item.body) } });
  }
  await prism.store.pending;

  const captures = await Promise.all(prism.store.captures.map((entry) => prism.store.readCapture(entry.id)));
  assert.equal(captures.length, 5);
  assert.equal(captures[0]?.adapter_id, 'openai-chat-completions', 'request path must win over Anthropic body and response');
  assert.equal(captures[0]?.prompt_input?.adapter_id, 'openai-chat-completions');
  assert.equal(captures[1]?.adapter_id, 'anthropic-messages');
  assert.deepEqual(captures[1]?.model_output?.content, [{ type: 'text', text: 'anthropic response' }]);

  assert.equal(captures[2]?.adapter_id, 'unresolved');
  assert.equal(captures[2]?.prompt_input, undefined);
  assert.equal(captures[2]?.model_output, undefined);
  assert.equal(captures[2]?.request?.body, responsesBody);
  assert.equal(captures[2]?.response?.body, responsesResponse);

  assert.equal(captures[3]?.adapter_id, 'unresolved');
  assert.equal(captures[3]?.prompt_input, undefined);
  assert.equal(captures[3]?.model_output, undefined);
  assert.equal(captures[3]?.request?.body, ambiguousBody);
  assert.equal(captures[3]?.response?.body, 'raw provider extension');

  assert.equal(captures[4]?.adapter_id, 'openai-chat-completions');
  assert.deepEqual(captures[4]?.model_output?.content, [{ type: 'text', text: 'still detected' }]);
  assert.deepEqual(prism.apiFormat, { mode: 'auto', configured: 'auto', resolved: null, source: null });
});

test('Auto uses an upstream hint only as fallback while explicit format overrides capture evidence', async (t) => {
  const openaiResponse = JSON.stringify({
    id: 'chatcmpl_hint', object: 'chat.completion', model: 'hint-model',
    choices: [{ index: 0, message: { role: 'assistant', content: 'hint output' }, finish_reason: 'stop' }], usage: {},
  });
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(openaiResponse); });
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const autoDir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-auto-hint-'));
  const auto = await createPromptPrism({ upstreamUrl: `http://127.0.0.1:${upstreamPort}/v1/chat/completions`, dataDir: autoDir });
  const autoPort = await listen(auto.server);
  t.after(() => close(auto.server));
  const ambiguousBody = JSON.stringify({ model: 'hint-model', messages: [{ role: 'user', content: 'ambiguous' }] });
  await request({ port: autoPort, pathname: '/custom/generate', headers: { 'content-type': 'application/json' }, body: ambiguousBody });
  await auto.store.pending;
  assert.equal(auto.store.captures[0]?.adapter_id, 'openai-chat-completions');

  const explicitDir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-explicit-format-'));
  const explicit = await createPromptPrism({ upstreamUrl: `http://127.0.0.1:${upstreamPort}/v1/chat/completions`, apiFormat: 'openai', dataDir: explicitDir });
  const explicitPort = await listen(explicit.server);
  t.after(() => close(explicit.server));
  const anthropicBody = JSON.stringify({ model: 'forced-openai', messages: [], tools: [{ name: 'read', input_schema: { type: 'object' } }] });
  await request({ port: explicitPort, pathname: '/v1/messages', headers: { 'content-type': 'application/json' }, body: anthropicBody });
  await explicit.store.pending;
  assert.equal(explicit.store.captures[0]?.adapter_id, 'openai-chat-completions');
  assert.deepEqual(explicit.apiFormat, { mode: 'explicit', configured: 'openai-chat-completions', resolved: 'openai-chat-completions', source: 'explicit' });
});

test('base URL mode derives provider endpoints without locking the Auto configuration', async (t) => {
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
  assert.deepEqual(prism.apiFormat, { mode: 'auto', configured: 'auto', resolved: null, source: null });
  const after = JSON.parse((await request({ port: proxyPort, pathname: '/_pp/api/config' })).body);
  assert.deepEqual(after.api_format, { mode: 'auto', configured: 'auto', resolved: null, source: null });
});

test('starts in dynamic-only mode without contacting an implicit Anthropic upstream', async (t) => {
  let seen = false;
  const upstream = http.createServer((req, res) => {
    seen = true;
    req.resume();
    req.on('end', () => {
      const body = JSON.stringify({ id: 'dynamic-only-message', type: 'message', role: 'assistant', model: 'dynamic-only', content: [{ type: 'text', text: 'dynamic hello' }], usage: { input_tokens: 1, output_tokens: 1 } });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
    });
  });
  const upstreamPort = await listen(upstream);
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-dynamic-only-'));
  const prism = await createPromptPrism({ dataDir: dir });
  const proxyPort = await listen(prism.server);
  t.after(async () => { await close(prism.server); await close(upstream); });

  assert.equal(prism.upstreamUrl, null);
  assert.equal(prism.upstreamMode, 'none');
  assert.deepEqual(prism.apiFormat, { mode: 'auto', configured: 'auto', resolved: null, source: null });
  const config = await request({ port: proxyPort, pathname: '/_pp/api/config' });
  assert.deepEqual(JSON.parse(config.body).api_format, { mode: 'auto', configured: 'auto', resolved: null, source: null });

  const ordinary = await request({ port: proxyPort, pathname: '/v1/messages' });
  assert.equal(ordinary.status, 503);
  assert.deepEqual(JSON.parse(ordinary.body), {
    error: 'No upstream configured',
    detail: 'Use a dynamic upstream URL under /_proxy/<encoded-upstream> or configure --upstream-base-url/--upstream-url',
  });
  assert.equal(seen, false);
  assert.equal(prism.store.captures.length, 0);

  const legacy = await request({ port: proxyPort, pathname: '/_pp/up/legacy-value/v1/messages' });
  assert.equal(legacy.status, 404);
  assert.equal(seen, false);

  const dynamicBase = buildDynamicProxyBaseUrl(`http://127.0.0.1:${upstreamPort}/gateway`, `http://127.0.0.1:${proxyPort}`);
  const dynamicPath = `${new URL(dynamicBase).pathname}/v1/messages?dynamic=1`;
  const body = JSON.stringify({ model: 'dynamic-only', messages: [{ role: 'user', content: 'hello' }] });
  const dynamic = await request({ port: proxyPort, pathname: dynamicPath, headers: { 'content-type': 'application/json' }, body });
  assert.equal(dynamic.status, 200);
  assert.equal(seen, true);
  await prism.store.pending;
  assert.equal(prism.store.captures.length, 1);
  const capture = await prism.store.readCapture(prism.store.captures[0]!.id);
  assert.equal(capture?.adapter_id, 'anthropic-messages');
  assert.equal(capture?.request?.target_url, `http://127.0.0.1:${upstreamPort}/gateway/v1/messages?dynamic=1`);
});

test('reports dynamic-only mode at startup when no upstream is configured', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-start-dynamic-only-'));
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => output.push(args.map(String).join(' '));
  let prism: Awaited<ReturnType<typeof startPromptPrism>> | undefined;
  try {
    prism = await startPromptPrism({ dataDir: dir, port: 0, open: false });
  } finally {
    console.log = originalLog;
  }
  assert.ok(prism);
  t.after(() => close(prism!.server));
  assert.equal(prism.upstreamUrl, null);
  assert.match(output.join('\n'), /Upstream\s+Dynamic only/);
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
  assert.equal((await request({ port: proxyPort, pathname: `/_pp/api/input-diff/${entry.id}` })).status, 422);
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

test('clear orders after a completed response and removes its capture and analysis', async (t) => {
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const body = JSON.stringify({
        id: 'msg_clear', type: 'message', role: 'assistant', model: 'claude-test',
        content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn',
        usage: { input_tokens: 2, output_tokens: 1 },
      });
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      res.end(body);
    });
  });
  const upstreamPort = await listen(upstream);
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-clear-'));
  const prism = await createPromptPrism({ upstreamUrl: `http://127.0.0.1:${upstreamPort}/v1/messages`, dataDir: dir });
  const proxyPort = await listen(prism.server);
  t.after(async () => { await close(prism.server); await close(upstream); });

  const body = JSON.stringify({ model: 'claude-test', messages: [{ role: 'user', content: 'clear me' }] });
  assert.equal((await request({ port: proxyPort, headers: { 'content-type': 'application/json' }, body })).status, 200);
  const cleared = await request({ port: proxyPort, pathname: '/_pp/api/logs', method: 'DELETE' });
  await prism.store.pending;

  assert.equal(cleared.status, 200);
  assert.deepEqual(JSON.parse(cleared.body), { cleared: true });
  assert.deepEqual(prism.store.captures, []);
  assert.equal(prism.analyzer.analyses.size, 0);
  assert.deepEqual(JSON.parse((await request({ port: proxyPort, pathname: '/_pp/api/logs' })).body), []);
});
