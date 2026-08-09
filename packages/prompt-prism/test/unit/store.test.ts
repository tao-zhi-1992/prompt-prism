import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access } from 'node:fs/promises';
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
