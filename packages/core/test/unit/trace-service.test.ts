import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
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

test('restores valid persisted relations and ignores records for evicted captures', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'prompt-prism-trace-'));
  const first = capture('first', '2026-08-14T00:00:00.000Z', [{ role: 'user', content: 'first' }]);
  const second = capture('second', '2026-08-14T00:00:01.000Z', [{ role: 'user', content: 'second' }]);
  await writeFile(path.join(directory, 'trace.jsonl'), [
    '',
    JSON.stringify({ id: 'first', parent_capture_id: null, source: 'explicit', reason: 'explicit_trace_id', version: 1 }),
    JSON.stringify({ id: 'evicted', parent_capture_id: null }),
  ].join('\n'));
  const service = new TraceService(directory);
  await service.init([entry(first), entry(second)]);
  assert.equal(service.getParentId('first'), null);
  assert.equal(service.getParentId('second'), null);
  assert.equal(service.getParentId('evicted'), undefined);
});

test('projects explicit and inferred traces, including append, rewritten, and truncated relations', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'prompt-prism-trace-'));
  const root = capture('root', '2026-08-14T00:00:00.000Z', [{ role: 'user', content: 'hello' }], { trace_id: 'explicit' });
  const explicitMissing = capture('missing', '2026-08-14T00:00:01.000Z', [{ role: 'user', content: 'missing' }], { trace_id: 'explicit' });
  const inferredRoot = capture('inferred-root', '2026-08-14T00:00:30.000Z', [{ role: 'user', content: 'hello' }]);
  const child = capture('child', '2026-08-14T00:01:00.000Z', [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'done' }, { role: 'user', content: 'next' }]);
  const rewritten = capture('rewritten', '2026-08-14T00:02:00.000Z', [{ role: 'user', content: 'different' }]);
  const orphan = capture('orphan', '2026-08-14T00:03:00.000Z', [{ role: 'user', content: 'orphan' }]);
  const all = [entry(root), entry(explicitMissing), entry(inferredRoot), entry(child), entry(rewritten), entry(orphan)];
  const service = new TraceService(directory);
  await service.init([entry(root), entry(inferredRoot)]);
  const storedChild = await service.prepare(child, entry(child), async (id) => id === inferredRoot.id ? inferredRoot : null, parse, output);
  assert.equal(storedChild.parent_capture_id, 'inferred-root');
  service.relations.set('rewritten', { id: 'rewritten', parent_capture_id: 'inferred-root', source: 'inferred', reason: 'input_prefix', version: 1 });
  service.relations.set('orphan', { id: 'orphan', parent_capture_id: 'gone', source: 'inferred', reason: 'input_prefix', version: 1 });
  service.published(all);

  const metadata = service.metadata(all);
  assert.deepEqual(metadata.get('root'), { trace_group_id: 'explicit', trace_group_source: 'explicit', trace_group_index: 1 });
  assert.deepEqual(metadata.get('missing'), { trace_group_id: 'explicit', trace_group_source: 'explicit', trace_group_index: 2 });
  assert.deepEqual(metadata.get('inferred-root'), { trace_group_id: 'inferred-root', trace_group_source: 'inferred', trace_group_index: 1 });
  assert.deepEqual(metadata.get('child'), { trace_group_id: 'inferred-root', trace_group_source: 'inferred', trace_group_index: 2 });
  assert.deepEqual(metadata.get('rewritten'), { trace_group_id: 'inferred-root', trace_group_source: 'inferred', trace_group_index: 3 });
  assert.deepEqual(metadata.get('orphan'), undefined);

  const explicitResult = await service.result('root', all, async (id) => id === root.id ? root : null, parse, output);
  assert.equal(explicitResult?.source, 'explicit');
  assert.equal(explicitResult?.calls.length, 2);
  assert.equal(explicitResult?.calls[0]?.input_relation, 'root');
  assert.equal(explicitResult?.calls[1]?.input_relation, 'rewritten');

  const inferredResult = await service.result('child', all, async (id) => ({ root, 'inferred-root': inferredRoot, child, rewritten, orphan }[id] ?? null), parse, output);
  assert.equal(inferredResult?.source, 'inferred');
  assert.equal(inferredResult?.truncated, false);
  assert.equal(inferredResult?.calls[0]?.input_relation, 'root');
  assert.equal(inferredResult?.calls[1]?.input_relation, 'append');

  assert.equal(await service.result('orphan', all, async () => null, parse, output), null);
  service.relations.set('orphan', { id: 'orphan', parent_capture_id: 'gone', source: 'inferred', reason: 'input_prefix', version: 1 });
  const truncated = await service.result('orphan', all, async (id) => id === 'orphan' ? orphan : null, parse, output);
  assert.equal(truncated?.truncated, true);
  assert.equal(truncated?.calls[0]?.input_relation, 'rewritten');
  assert.equal(await service.result('unknown', all, async () => null, parse, output), null);
});

test('keeps raw and malformed captures safe while preparing relation metadata', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'prompt-prism-trace-'));
  const raw = capture('raw', '2026-08-14T00:00:00.000Z', [], { adapter_id: 'unresolved', prompt_input: undefined, request: { method: 'POST', url: '/', headers: {}, body: '{bad' } });
  const malformed = capture('malformed', '2026-08-14T00:00:01.000Z', [{ role: 'user', content: 'x' }], { request: { method: 'POST', url: '/', headers: {}, body: '{bad' }, response: { status: 200, headers: {}, body: '{bad' } });
  const service = new TraceService(directory);
  await service.init([entry(raw), entry(malformed)]);
  assert.equal((await service.prepare(raw, entry(raw), async () => raw, parse, output)).parent_capture_id, undefined);
  assert.equal((await service.result('raw', [entry(raw)], async () => raw, parse, output))?.calls[0]?.input_relation, 'root');
  assert.equal((await service.result('malformed', [entry(malformed)], async () => malformed, parse, output))?.calls[0]?.input_relation, 'root');
});
