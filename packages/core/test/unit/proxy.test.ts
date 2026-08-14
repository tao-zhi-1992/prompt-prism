import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPromptPrismCore } from '../../src/proxy.js';
import type { Capture, CaptureIndexEntry } from '../../src/types.js';
import type { ServerPluginRuntime } from '../../src/plugins.js';

function pendingCapture(): Capture {
  return {
    id: 'pending',
    timestamp: '2026-08-14T00:00:00.000Z',
    token_hash: 'hash',
    model: 'model',
    messages: [],
    usage: {},
    adapter_id: 'unresolved',
    request: { method: 'POST', url: '/', headers: {}, body: 'raw' },
    response: { status: 200, headers: {}, body: 'raw' },
  };
}

function runtime(onCapture: (capture: Capture, entry: CaptureIndexEntry) => Promise<void>): ServerPluginRuntime {
  return {
    init: async () => {},
    onCapture,
    onEvict: () => {},
    onClear: async () => {},
    handleApi: async () => false,
  };
}

test('replays pending captures through Trace and plugin finalization before publishing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-proxy-pending-'));
  const capture = pendingCapture();
  const entry: CaptureIndexEntry = { ...capture, file_ref: 'hash/pending.json' };
  await mkdir(path.join(dir, 'hash'), { recursive: true });
  await writeFile(path.join(dir, entry.file_ref), JSON.stringify(capture));
  await writeFile(path.join(dir, 'pending.jsonl'), `${JSON.stringify(entry)}\n`);
  const finalized: string[] = [];
  const instance = await createPromptPrismCore({ dataDir: dir, open: false }, runtime(async (value, stored) => {
    finalized.push(`${value.id}:${stored.id}`);
  }));

  assert.deepEqual(finalized, ['pending:pending']);
  assert.deepEqual(instance.store.captures.map(({ id }) => id), ['pending']);
  assert.deepEqual((instance.store as unknown as { pendingCaptures: CaptureIndexEntry[] }).pendingCaptures, []);
  if (instance.server.listening) await new Promise<void>((resolve, reject) => instance.server.close((error) => error ? reject(error) : resolve()));
});
