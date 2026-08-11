import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPromptPrism } from 'prompt-prism';
import { DEFAULT_DEMO_API_FORMAT, DEFAULT_DEMO_BASE_URL, messagesUrl, openAIBaseUrl, parseApiFormat, parseBaseUrl, startDemo } from '../../server.js';

const listen = (server: http.Server) => new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as import('node:net').AddressInfo).port)));
const close = (server: http.Server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

function request({ port, pathname, method = 'GET', body }: { port: number; pathname: string; method?: string; body?: string }) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {} }, (response) => {
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function waitFor<T>(get: () => Promise<T | undefined>, label: string): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await get();
    if (result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function sse(response: http.ServerResponse, events: unknown[]): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of events) response.write(`event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`);
  response.end();
}

function openAISse(response: http.ServerResponse, chunks: unknown[]): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  response.end('data: [DONE]\n\n');
}

test('Pi Coding Agent streams through Prism, pauses for approval, and captures the tool loop', async (t) => {
  const modelRequests: Array<{ token: string | undefined; body: Record<string, unknown>; url: string | undefined }> = [];
  const modelService = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      modelRequests.push({ token: request.headers['x-api-key'] as string | undefined, body, url: request.url });
      const secondTurn = modelRequests.length > 1;
      sse(response, secondTurn ? [
        { type: 'message_start', message: { id: 'msg_2', type: 'message', role: 'assistant', content: [], model: 'demo-test-model', stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Fixed and verified the pagination behavior.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } },
        { type: 'message_stop' }
      ] : [
        { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'demo-test-model', stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_read', name: 'read', input: {} } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"src/http.ts"}' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 4 } },
        { type: 'message_stop' }
      ]);
    });
  });
  const modelPort = await listen(modelService);
  const dataDir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-pi-'));
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'prompt-prism-workspaces-'));
  const prism = await createPromptPrism({ upstreamUrl: `http://127.0.0.1:${modelPort}/tenant/demo/v1/messages`, dataDir });
  const prismPort = await listen(prism.server);
  const demo = await startDemo({ baseUrl: `http://127.0.0.1:${prismPort}`, providerToken: 'demo-secret', model: 'demo-test-model', demoPort: 0, workspaceRoot });
  t.after(async () => { await demo.close(); await close(prism.server); await close(modelService); });

  const created = JSON.parse((await request({ port: demo.demoPort, pathname: '/api/sessions', method: 'POST' })).body) as { id: string; workspace: string };
  assert.match(created.id, /^[a-f0-9-]{36}$/);
  assert.equal((await readFile(path.join(created.workspace, 'src/http.ts'), 'utf8')).includes('Number(value) || 20'), true);
  const page = await request({ port: demo.demoPort, pathname: '/' });
  assert.equal(page.status, 200);
  assert.match(page.body, /approval required/i);
  assert.match((await request({ port: demo.demoPort, pathname: '/brand/favicon-32.png' })).headers['content-type'] ?? '', /image\/png/);

  const sent = await request({ port: demo.demoPort, pathname: `/api/sessions/${created.id}/messages`, method: 'POST', body: JSON.stringify({ content: 'Inspect the failing test and fix it.', model: 'attacker-model', providerToken: 'attacker-token' }) });
  assert.equal(sent.status, 202);
  const pending = await waitFor(async () => {
    const snapshot = JSON.parse((await request({ port: demo.demoPort, pathname: `/api/sessions/${created.id}` })).body) as { pendingApprovals: Array<{ toolCallId: string; toolName: string }> };
    return snapshot.pendingApprovals[0];
  }, 'tool approval');
  assert.equal(pending.toolName, 'read');
  assert.equal(modelRequests.length, 1);
  assert.equal(modelRequests[0]!.url, '/tenant/demo/v1/messages');
  assert.equal(modelRequests[0]!.token, 'demo-secret');
  assert.equal(modelRequests[0]!.body.model, 'demo-test-model');
  assert.equal(modelRequests[0]!.body.stream, true);

  const approved = await request({ port: demo.demoPort, pathname: `/api/sessions/${created.id}/approvals/${pending.toolCallId}`, method: 'POST', body: JSON.stringify({ approved: true }) });
  assert.equal(approved.status, 200);
  const completed = await waitFor(async () => {
    const snapshot = JSON.parse((await request({ port: demo.demoPort, pathname: `/api/sessions/${created.id}` })).body) as { active: boolean; events: Array<{ type: string; content?: string }> };
    return !snapshot.active && snapshot.events.some((event) => event.type === 'turn_complete') ? snapshot : undefined;
  }, 'agent completion');
  assert.ok(completed.events.some((event) => event.type === 'tool_result' && event.content?.includes('parseLimit')));
  assert.equal(modelRequests.length, 2);
  await prism.store.pending;
  assert.equal(prism.store.captures.length, 2);
  assert.ok(prism.store.captures.every((capture) => capture.trace_id === created.id));
  const traceCapture = prism.store.captures[0];
  assert.ok(traceCapture);
  const traceResponse = await request({ port: prismPort, pathname: `/_pp/api/trace/${traceCapture.id}` });
  const trace = JSON.parse(traceResponse.body) as { source: string; id: string; calls: Array<{ input_delta: Array<{ content: Array<{ type: string }> }>; output?: { content: Array<{ type: string }> } }> };
  assert.equal(trace.source, 'explicit');
  assert.equal(trace.id, created.id);
  assert.equal(trace.calls.length, 2);
  assert.ok(trace.calls[0]?.output?.content.some((block) => block.type === 'tool_call'));
  assert.ok(trace.calls[1]?.input_delta.some((message) => message.content.some((block) => block.type === 'tool_result')));
  assert.ok(trace.calls[1]?.output?.content.some((block) => block.type === 'text'));

  const reset = JSON.parse((await request({ port: demo.demoPort, pathname: `/api/sessions/${created.id}/reset`, method: 'POST' })).body) as { id: string; workspace: string };
  assert.notEqual(reset.id, created.id);
  await assert.rejects(access(created.workspace));
  await access(reset.workspace);
});

test('Pi Coding Agent uses OpenAI Chat Completions through the OpenAI Prism adapter', async (t) => {
  const modelRequests: Array<{ authorization: string | undefined; body: Record<string, unknown>; url: string | undefined }> = [];
  const modelService = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      modelRequests.push({ authorization: request.headers.authorization, body, url: request.url });
      const secondTurn = modelRequests.length > 1;
      openAISse(response, secondTurn ? [
        {
          id: 'chatcmpl_2', object: 'chat.completion.chunk', created: 1, model: 'openai-demo-model',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'Fixed and verified the pagination behavior.' }, finish_reason: null }],
        },
        {
          id: 'chatcmpl_2', object: 'chat.completion.chunk', created: 1, model: 'openai-demo-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        },
        {
          id: 'chatcmpl_2', object: 'chat.completion.chunk', created: 1, model: 'openai-demo-model', choices: [],
          usage: { prompt_tokens: 30, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 20 } },
        },
      ] : [
        {
          id: 'chatcmpl_1', object: 'chat.completion.chunk', created: 1, model: 'openai-demo-model',
          choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_read', type: 'function', function: { name: 'read', arguments: '{"path":"src/http.ts"}' } }] }, finish_reason: null }],
        },
        {
          id: 'chatcmpl_1', object: 'chat.completion.chunk', created: 1, model: 'openai-demo-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        },
        {
          id: 'chatcmpl_1', object: 'chat.completion.chunk', created: 1, model: 'openai-demo-model', choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 0 } },
        },
      ]);
    });
  });
  const modelPort = await listen(modelService);
  const dataDir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-pi-openai-'));
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'prompt-prism-openai-workspaces-'));
  const prism = await createPromptPrism({
    upstreamUrl: `http://127.0.0.1:${modelPort}/tenant/demo/v1/chat/completions`,
    apiFormat: 'openai',
    dataDir,
  });
  const prismPort = await listen(prism.server);
  const demo = await startDemo({
    baseUrl: `http://127.0.0.1:${prismPort}`, apiFormat: 'openai', providerToken: 'openai-demo-secret',
    model: 'openai-demo-model', demoPort: 0, workspaceRoot,
  });
  t.after(async () => { await demo.close(); await close(prism.server); await close(modelService); });

  assert.equal(demo.apiFormat, 'openai-chat-completions');
  const config = JSON.parse((await request({ port: demo.demoPort, pathname: '/api/config' })).body) as { model: string; apiFormat: string; fixture: string };
  assert.deepEqual(config, { model: 'openai-demo-model', apiFormat: 'openai-chat-completions', fixture: 'inventory-service' });
  const created = JSON.parse((await request({ port: demo.demoPort, pathname: '/api/sessions', method: 'POST' })).body) as { id: string };
  const sent = await request({
    port: demo.demoPort, pathname: `/api/sessions/${created.id}/messages`, method: 'POST',
    body: JSON.stringify({ content: 'Inspect the failing test and fix it.', apiFormat: 'anthropic', model: 'attacker-model' }),
  });
  assert.equal(sent.status, 202);
  const pending = await waitFor(async () => {
    const snapshot = JSON.parse((await request({ port: demo.demoPort, pathname: `/api/sessions/${created.id}` })).body) as { active: boolean; pendingApprovals: Array<{ toolCallId: string; toolName: string }>; events: Array<{ type: string; message?: string }> };
    const failure = snapshot.events.find((event) => event.type === 'error');
    if (failure) throw new Error(`OpenAI agent failed before approval: ${failure.message ?? 'unknown error'}`);
    if (!snapshot.active && snapshot.pendingApprovals.length === 0) throw new Error(`OpenAI agent finished without a tool call: ${JSON.stringify(snapshot.events)}`);
    return snapshot.pendingApprovals[0];
  }, 'OpenAI tool approval');
  assert.equal(pending.toolName, 'read');
  assert.equal(modelRequests[0]?.url, '/tenant/demo/v1/chat/completions');
  assert.equal(modelRequests[0]?.authorization, 'Bearer openai-demo-secret');
  assert.equal(modelRequests[0]?.body.model, 'openai-demo-model');
  assert.equal(modelRequests[0]?.body.stream, true);
  assert.ok(Array.isArray(modelRequests[0]?.body.messages));
  assert.equal('input' in modelRequests[0]!.body, false, 'Pi must use Chat Completions rather than Responses');
  assert.equal((modelRequests[0]?.body.tools as Array<{ type: string; function?: { name?: string } }>)[0]?.function?.name, 'read');

  const approved = await request({
    port: demo.demoPort, pathname: `/api/sessions/${created.id}/approvals/${pending.toolCallId}`, method: 'POST',
    body: JSON.stringify({ approved: true }),
  });
  assert.equal(approved.status, 200);
  await waitFor(async () => {
    const snapshot = JSON.parse((await request({ port: demo.demoPort, pathname: `/api/sessions/${created.id}` })).body) as { active: boolean; events: Array<{ type: string }> };
    return !snapshot.active && snapshot.events.some((event) => event.type === 'turn_complete') ? snapshot : undefined;
  }, 'OpenAI agent completion');

  assert.equal(modelRequests.length, 2);
  const secondMessages = modelRequests[1]?.body.messages as Array<{ role?: string }>;
  assert.ok(secondMessages.some((message) => message.role === 'tool'));
  await prism.store.pending;
  assert.equal(prism.store.captures.length, 2);
  assert.ok(prism.store.captures.every((capture) => capture.adapter_id === 'openai-chat-completions' && capture.trace_id === created.id));
  assert.deepEqual(prism.store.captures[1]?.usage, { input_tokens: 10, output_tokens: 8, cache_read_input_tokens: 20 });
  const traceResponse = await request({ port: prismPort, pathname: `/_pp/api/trace/${prism.store.captures[1]!.id}` });
  const trace = JSON.parse(traceResponse.body) as { calls: Array<{ input_delta: Array<{ content: Array<{ type: string }> }>; output: { content: Array<{ type: string }> } }> };
  assert.equal(trace.calls.length, 2);
  assert.ok(trace.calls[0]?.output.content.some((block) => block.type === 'tool_call'));
  assert.ok(trace.calls[1]?.input_delta.some((message) => message.content.some((block) => block.type === 'tool_result')));
  assert.ok(trace.calls[1]?.output.content.some((block) => block.type === 'text'));
});

test('Demo defaults to local Prompt Prism and validates its base URL and required credentials', async (t) => {
  assert.equal(DEFAULT_DEMO_BASE_URL, 'http://127.0.0.1:1028');
  assert.equal(DEFAULT_DEMO_API_FORMAT, 'auto');
  assert.equal(messagesUrl(parseBaseUrl('https://example.com/prism/')).href, 'https://example.com/prism/v1/messages');
  assert.equal(openAIBaseUrl(parseBaseUrl('https://example.com/prism/')).href, 'https://example.com/prism/v1');
  assert.equal(parseApiFormat('openai'), 'openai');
  assert.throws(() => parseApiFormat('responses'), /auto, anthropic-messages, or openai-chat-completions/);
  await assert.rejects(startDemo({ baseUrl: 'ftp://example.com', providerToken: 'token', model: 'model', demoPort: 0 }), /http or https/);
  await assert.rejects(startDemo({ baseUrl: 'https://example.com/v1', providerToken: 'token', model: 'model', demoPort: 0 }), /base URL without \/v1/);
  await assert.rejects(startDemo({ baseUrl: 'https://example.com/prefix/v1/chat/completions', providerToken: 'token', model: 'model', demoPort: 0 }), /base URL without \/v1/);
  await assert.rejects(startDemo({ baseUrl: 'http://localhost', model: 'model', demoPort: 0 }), /Missing DEMO_MODEL_PROVIDER_TOKEN/);
  await assert.rejects(startDemo({ baseUrl: 'http://localhost', providerToken: 'token', demoPort: 0 }), /Missing DEMO_AGENT_MODEL/);

  const perCaptureAuto = http.createServer((_request, response) => {
    const body = JSON.stringify({ api_format: { mode: 'auto', configured: 'auto', resolved: null, source: null } });
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    response.end(body);
  });
  const perCaptureAutoPort = await listen(perCaptureAuto);
  t.after(() => close(perCaptureAuto));
  const automatic = await startDemo({
    baseUrl: `http://127.0.0.1:${perCaptureAutoPort}`, providerToken: 'token', model: 'model', demoPort: 0,
    workspaceRoot: await mkdtemp(path.join(tmpdir(), 'prompt-prism-auto-demo-')),
  });
  assert.equal(automatic.apiFormat, 'anthropic-messages');
  await automatic.close();

  const explicit = await startDemo({ baseUrl: 'http://127.0.0.1:1', apiFormat: 'anthropic', providerToken: 'token', model: 'model', demoPort: 0, workspaceRoot: await mkdtemp(path.join(tmpdir(), 'prompt-prism-explicit-demo-')) });
  await explicit.close();
});
