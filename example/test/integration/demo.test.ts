import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPromptPrism } from 'prompt-prism';
import { DEFAULT_DEMO_BASE_URL, messagesUrl, parseBaseUrl, startDemo } from '../../server.js';

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

  const reset = JSON.parse((await request({ port: demo.demoPort, pathname: `/api/sessions/${created.id}/reset`, method: 'POST' })).body) as { id: string; workspace: string };
  assert.notEqual(reset.id, created.id);
  await assert.rejects(access(created.workspace));
  await access(reset.workspace);
});

test('Demo defaults to local Prompt Prism and validates its base URL and required credentials', async () => {
  assert.equal(DEFAULT_DEMO_BASE_URL, 'http://127.0.0.1:8787');
  assert.equal(messagesUrl(parseBaseUrl('https://example.com/prism/')).href, 'https://example.com/prism/v1/messages');
  await assert.rejects(startDemo({ baseUrl: 'ftp://example.com', providerToken: 'token', model: 'model', demoPort: 0 }), /http or https/);
  await assert.rejects(startDemo({ baseUrl: 'https://example.com/v1', providerToken: 'token', model: 'model', demoPort: 0 }), /base URL without \/v1/);
  await assert.rejects(startDemo({ baseUrl: 'http://localhost', model: 'model', demoPort: 0 }), /Missing DEMO_MODEL_PROVIDER_TOKEN/);
  await assert.rejects(startDemo({ baseUrl: 'http://localhost', providerToken: 'token', demoPort: 0 }), /Missing DEMO_AGENT_MODEL/);
});
