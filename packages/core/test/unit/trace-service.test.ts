import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TraceService } from '../../src/trace-service.js';
import { parseRequest, parseResponse } from '../../src/adapter/openai.js';
import type { Capture, CaptureIndexEntry } from '../../src/types.js';

function capture(id: string, timestamp: string, messages: unknown[], overrides: Partial<Capture> = {}): Capture {
  const request = { model: 'gpt-test', messages };
  const input = parseRequest(JSON.stringify(request)).input;
  return { id, timestamp, token_hash: 'same-token', model: 'gpt-test', messages: messages as Capture['messages'], adapter_id: 'openai-chat-completions', prompt_input: input, usage: {}, upstream_host: 'api.example.com', request: { method: 'POST', url: '/v1/chat/completions', headers: {}, body: JSON.stringify(request) }, response: { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ object: 'chat.completion', choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }] }) }, ...overrides };
}
function entry(value: Capture): CaptureIndexEntry { return { id: value.id, timestamp: value.timestamp, token_hash: value.token_hash, model: value.model, usage: value.usage, upstream_host: value.upstream_host, file_ref: `${value.id}.json`, messages: value.messages, adapter_id: value.adapter_id, prompt_input: value.prompt_input, trace_id: value.trace_id }; }
const parse = (id: string, body: string) => parseRequest(body);
const output = (id: string, body: string, contentType?: string) => parseResponse(body, contentType);

test('Trace relations require a unique recent, compatible prefix candidate and persist provenance', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'prompt-prism-trace-'));
  const root = capture('root', '2026-08-14T00:00:00.000Z', [{ role: 'user', content: 'hello' }]);
  const child = capture('child', '2026-08-14T00:01:00.000Z', [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'done' }, { role: 'user', content: 'next' }]);
  const service = new TraceService(directory); await service.init([entry(root)]);
  const stored = await service.prepare(child, entry(child), async (id) => id === root.id ? root : null, parse, output);
  assert.equal(stored.parent_capture_id, 'root');
  assert.equal(stored.trace_relation_source, 'inferred');
  assert.equal(stored.trace_relation_reason, 'input_prefix');
  assert.equal(stored.trace_relation_version, 1);
});

test('Trace inference refuses ambiguous or stale candidates', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'prompt-prism-trace-'));
  const messages = [{ role: 'user', content: 'hello' }];
  const first = capture('first', '2026-08-14T00:00:00.000Z', messages);
  const second = capture('second', '2026-08-14T00:00:01.000Z', messages);
  const ambiguous = capture('ambiguous', '2026-08-14T00:02:00.000Z', [...messages, { role: 'user', content: 'next' }]);
  const service = new TraceService(directory); await service.init([entry(first), entry(second)]);
  const result = await service.prepare(ambiguous, entry(ambiguous), async () => null, parse, output);
  assert.equal(result.parent_capture_id, undefined);
  const stale = capture('stale', '2026-08-14T01:00:01.000Z', [...messages, { role: 'user', content: 'next' }]);
  const staleResult = await service.prepare(stale, entry(stale), async () => null, parse, output);
  assert.equal(staleResult.parent_capture_id, undefined);
});
