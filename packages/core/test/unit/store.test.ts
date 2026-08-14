import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access, appendFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CaptureStore } from '../../src/store.js';
import type { Capture } from '../../src/types.js';

function capture(id: string, timestamp: string, payload = ''): Capture {
  return { id, timestamp, token_hash: 'hash', model: 'test', messages: [], usage: {}, payload };
}

test('storage cap evicts oldest file and its index entry', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-store-'));
  const store = await new CaptureStore({ dataDir: dir, maxBytes: 700 }).init();
  const first = await store.writeCapture(capture('first', '2026-01-01T00:00:00.000Z', 'x'.repeat(300)));
  await store.writeCapture(capture('second', '2026-01-02T00:00:00.000Z', 'y'.repeat(300)));
  assert.deepEqual(store.captures.map((item) => item.id), ['second']);
  assert.ok(first);
  await assert.rejects(access(path.join(dir, first.file_ref)));
  const lines = (await readFile(store.capturesPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((item) => item.id), ['second']);
});

test('a single capture larger than the cap is not written', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-store-'));
  const store = await new CaptureStore({ dataDir: dir, maxBytes: 100 }).init();
  assert.equal(await store.writeCapture(capture('large', '2026-01-01T00:00:00.000Z', 'x'.repeat(300))), null);
  assert.equal(store.captures.length, 0);
});

test('clears captures and detail files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-store-'));
  const store = await new CaptureStore({ dataDir: dir }).init();
  const captures = store.captures;
  const written = await store.writeCapture(capture('clear-me', '2026-01-01T00:00:00.000Z'));
  assert.ok(written);
  await store.clear();
  assert.strictEqual(store.captures, captures);
  assert.deepEqual(store.captures, []);
  await assert.rejects(access(store.capturesPath));
  await assert.rejects(access(path.join(dir, written.file_ref)));
});

test('serializes captures queued after clear and preserves their index and detail file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-store-'));
  const events: string[] = [];
  let releaseFirst!: () => void;
  let firstCallbackStarted!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const callbackStarted = new Promise<void>((resolve) => { firstCallbackStarted = resolve; });

  class ObservedStore extends CaptureStore {
    protected override async persistCapture(value: Capture) {
      events.push(`write:${value.id}`);
      return super.persistCapture(value);
    }
  }

  const store = await new ObservedStore({ dataDir: dir }).init();
  store.onClear = async () => {
    events.push('clear:start');
    await Promise.resolve();
    events.push('clear:complete');
  };
  const first = store.enqueue(capture('before-clear', '2026-01-01T00:00:00.000Z'), async () => {
    firstCallbackStarted();
    await firstGate;
  });
  await callbackStarted;

  const clearing = store.clear();
  const after = store.enqueue(capture('after-clear', '2026-01-02T00:00:00.000Z'), () => {
    events.push('analyze:after-clear');
  });
  releaseFirst();

  await Promise.all([first, clearing, after]);
  assert.deepEqual(events, ['write:before-clear', 'clear:start', 'clear:complete', 'write:after-clear', 'analyze:after-clear']);
  assert.deepEqual(store.captures.map((item) => item.id), ['after-clear']);
  assert.equal((await store.readCapture('after-clear'))?.id, 'after-clear');

  const restarted = await new CaptureStore({ dataDir: dir }).init();
  assert.deepEqual(restarted.captures.map((item) => item.id), ['after-clear']);
  assert.equal((await restarted.readCapture('after-clear'))?.id, 'after-clear');
});

test('recovers the operation queue after a clear callback fails', async (context) => {
  context.mock.method(console, 'error', () => {});
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-store-'));
  const store = await new CaptureStore({ dataDir: dir }).init();
  store.onClear = () => { throw new Error('plugin clear failed'); };

  await assert.rejects(store.clear(), /plugin clear failed/);
  const stored = await store.enqueue(capture('after-failed-clear', '2026-01-02T00:00:00.000Z'));

  assert.equal(stored?.id, 'after-failed-clear');
  assert.equal((await store.readCapture('after-failed-clear'))?.id, 'after-failed-clear');
});

test('removes the detail file when the pending journal cannot be appended', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-store-pending-write-'));
  const store = await new CaptureStore({ dataDir: dir }).init();
  (store as unknown as { pendingPath: string }).pendingPath = path.join(dir, 'missing', 'pending.jsonl');

  await assert.rejects(store.enqueue(capture('pending-write', '2026-01-01T00:00:00.000Z')), /ENOENT/);
  assert.equal(store.captures.length, 0);
  await assert.rejects(access(path.join(dir, 'hash', '2026-01-01T00-00-00-000Z_pending-write.json')));
});

test('recovers pending entries with missing and valid detail files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-store-pending-recovery-'));
  const missing = capture('missing-pending', '2026-01-01T00:00:00.000Z');
  const valid = capture('valid-pending', '2026-01-02T00:00:00.000Z');
  const missingEntry = { ...missing, file_ref: 'hash/missing-pending.json' };
  const validEntry = { ...valid, file_ref: 'hash/valid-pending.json' };
  await writeFile(path.join(dir, 'pending.jsonl'), `${JSON.stringify(missingEntry)}\n${JSON.stringify(validEntry)}\n`);
  await mkdir(path.join(dir, 'hash'), { recursive: true });
  await writeFile(path.join(dir, validEntry.file_ref), JSON.stringify(valid));

  const store = await new CaptureStore({ dataDir: dir }).init();
  assert.deepEqual(store.pendingCaptures.map(({ id }) => id), ['missing-pending', 'valid-pending']);
  const seen: string[] = [];
  await store.recoverPending(async (value, entry) => { seen.push(`${value.id}:${entry.id}`); return entry; });

  assert.deepEqual(seen, ['valid-pending:valid-pending']);
  assert.deepEqual(store.captures.map(({ id }) => id), ['valid-pending']);
  assert.deepEqual(store.pendingCaptures, []);
});

test('persists HTTP status, upstream host, trace ID, and timing in the capture index across restarts', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-store-'));
  const store = await new CaptureStore({ dataDir: dir }).init();
  await store.writeCapture({
    ...capture('http-metadata', '2026-01-01T00:00:00.000Z'),
    adapter_id: 'anthropic',
    prompt_input: {
      adapter_id: 'anthropic', primary_section_id: 'messages',
      sections: [{ id: 'messages', label: 'Messages', order: 10, value: [], compare_as: 'sequence', default_collapsed: false }]
    },
    upstream_host: 'provider.example.com:8443',
    trace_id: 'session:one',
    trace_parent_capture_id: 'parent-capture',
    timing: {
      started_at: '2026-01-01T00:00:00.000Z', completed_at: '2026-01-01T00:00:00.100Z',
      duration_ms: 100, time_to_headers_ms: 20, time_to_first_byte_ms: 30,
    },
    response: { status: 429, headers: {}, body: '{"error":"rate limited"}' }
  });

  const restarted = await new CaptureStore({ dataDir: dir }).init();
  assert.equal(restarted.captures[0]?.response_status, 429);
  assert.equal(restarted.captures[0]?.upstream_host, 'provider.example.com:8443');
  assert.equal(restarted.captures[0]?.trace_id, 'session:one');
  assert.equal(restarted.captures[0]?.trace_parent_capture_id, 'parent-capture');
  assert.equal(restarted.captures[0]?.timing?.time_to_first_byte_ms, 30);
  assert.equal(restarted.captures[0]?.adapter_id, 'anthropic-messages');
  assert.equal(restarted.captures[0]?.prompt_input?.primary_section_id, 'messages');
});

test('repairs an incomplete final capture index record before appending again', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-store-recovery-'));
  const store = await new CaptureStore({ dataDir: dir }).init();
  await store.writeCapture(capture('valid', '2026-01-01T00:00:00.000Z'));
  await appendFile(store.capturesPath, '{"id":"partial"');

  const recovered = await new CaptureStore({ dataDir: dir }).init();
  assert.deepEqual(recovered.captures.map(({ id }) => id), ['valid']);
  assert.doesNotMatch(await readFile(recovered.capturesPath, 'utf8'), /partial/);
  await recovered.writeCapture(capture('next', '2026-01-02T00:00:00.000Z'));

  const restarted = await new CaptureStore({ dataDir: dir }).init();
  assert.deepEqual(restarted.captures.map(({ id }) => id), ['valid', 'next']);
});

test('normalizes a complete capture index record without a final newline', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-store-newline-'));
  const store = await new CaptureStore({ dataDir: dir }).init();
  await store.writeCapture(capture('valid', '2026-01-01T00:00:00.000Z'));
  const content = await readFile(store.capturesPath, 'utf8');
  await writeFile(store.capturesPath, content.trimEnd());

  const recovered = await new CaptureStore({ dataDir: dir }).init();
  await recovered.writeCapture(capture('next', '2026-01-02T00:00:00.000Z'));

  const restarted = await new CaptureStore({ dataDir: dir }).init();
  assert.deepEqual(restarted.captures.map(({ id }) => id), ['valid', 'next']);
});

test('rejects corruption before the incomplete tail of the capture index', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-store-corrupt-'));
  const store = await new CaptureStore({ dataDir: dir }).init();
  await writeFile(store.capturesPath, '{bad}\n{"id":"partial"');

  await assert.rejects(new CaptureStore({ dataDir: dir }).init(), /Invalid capture index record at line 1/);
});

test('rejects syntactically valid capture index records with missing fields', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-store-invalid-'));
  const store = await new CaptureStore({ dataDir: dir }).init();
  await writeFile(store.capturesPath, '{"id":"incomplete"}');

  await assert.rejects(new CaptureStore({ dataDir: dir }).init(), /Invalid capture index record at line 1/);
});

test('rejects capture writes and historical index entries outside the data directory', async (context) => {
  context.mock.method(console, 'error', () => {});
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-store-paths-'));
  const store = await new CaptureStore({ dataDir: dir }).init();
  await assert.rejects(store.writeCapture({ ...capture('escape', '2026-01-01T00:00:00.000Z'), token_hash: '../outside' }), /safe path segment/);
  await assert.rejects(store.writeCapture(capture('../escape', '2026-01-01T00:00:00.000Z')), /Capture ID must be a safe path segment/);
  await assert.rejects(store.writeCapture(capture('invalid-time', 'not-a-date')), /Capture timestamp must be a valid date/);

  const malicious = {
    id: 'malicious', timestamp: '2026-01-01T00:00:00.000Z', token_hash: 'hash', model: 'test',
    usage: {}, file_ref: '../outside.json', messages: [],
  };
  await writeFile(store.capturesPath, `${JSON.stringify(malicious)}\n`);
  await assert.rejects(new CaptureStore({ dataDir: dir }).init(), /stay within the data directory/);
});

test('removes index entries whose capture detail file disappeared during an interrupted eviction', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-store-missing-detail-'));
  const store = await new CaptureStore({ dataDir: dir }).init();
  const missing = await store.writeCapture(capture('missing', '2026-01-01T00:00:00.000Z'));
  const retained = await store.writeCapture(capture('retained', '2026-01-02T00:00:00.000Z'));
  assert.ok(missing && retained);
  await rm(path.join(dir, missing.file_ref));

  const recovered = await new CaptureStore({ dataDir: dir }).init();

  assert.deepEqual(recovered.captures.map(({ id }) => id), ['retained']);
  const persisted = (await readFile(recovered.capturesPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line).id);
  assert.deepEqual(persisted, ['retained']);
});

test('rejects duplicate capture IDs at runtime and during startup', async (context) => {
  context.mock.method(console, 'error', () => {});
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-store-duplicate-'));
  const store = await new CaptureStore({ dataDir: dir }).init();
  await store.writeCapture(capture('duplicate', '2026-01-01T00:00:00.000Z'));
  await assert.rejects(store.writeCapture(capture('duplicate', '2026-01-02T00:00:00.000Z')), /Capture ID already exists/);

  const firstLine = (await readFile(store.capturesPath, 'utf8')).trim();
  await appendFile(store.capturesPath, `${firstLine}\n`);
  await assert.rejects(new CaptureStore({ dataDir: dir }).init(), /Duplicate capture ID at line 2/);
});
