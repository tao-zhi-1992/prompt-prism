import type http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminHandler } from '../../src/server.js';
import type { Analysis, ApiFormatResolution, CaptureIndexEntry } from '../../src/types.js';

function entry(id: string, timestamp: string, traceId?: string): CaptureIndexEntry {
  return {
    id,
    timestamp,
    token_hash: 'token',
    model: 'model',
    usage: {},
    file_ref: `${id}.json`,
    messages: [],
    ...(traceId ? { trace_id: traceId } : {}),
  };
}

function analysis(id: string, parentId: string | null): Analysis {
  return {
    id,
    timestamp: '2026-08-09T00:00:00.000Z',
    matched_parent_id: parentId,
    matched_message_count: 0,
    divergence_point: 0,
    diff: [],
    estimated_cacheable_tokens: 0,
    actual_cache_read_tokens: 0,
    estimated_cache_miss: 0,
    cache_hit_below_expected: false,
  };
}

async function logs(captures: CaptureIndexEntry[], analyses: Map<string, Analysis>): Promise<Array<Record<string, unknown>>> {
  let body: Array<Record<string, unknown>> = [];
  const response = {
    writeHead: () => response,
    end: (value: string) => { body = JSON.parse(value) as Array<Record<string, unknown>>; },
  } as unknown as http.ServerResponse;
  const apiFormat = (): ApiFormatResolution => ({ mode: 'auto', configured: 'auto', resolved: null, source: null });
  const handler = createAdminHandler({
    store: { captures, readCapture: async () => null, clear: async () => {} },
    analyzer: { analyses },
    plugins: { handleApi: async () => false },
    apiFormat,
  });
  await handler({ method: 'GET', url: '/_pp/api/logs' } as http.IncomingMessage, response);
  return body;
}

test('adds explicit and inferred trace group metadata without rewriting trace_id', async () => {
  const captures = [
    entry('explicit-one', '2026-08-09T00:00:00.000Z', 'session-one'),
    entry('explicit-two', '2026-08-09T00:00:01.000Z', 'session-one'),
    entry('root', '2026-08-09T00:00:02.000Z'),
    entry('child', '2026-08-09T00:00:03.000Z'),
    entry('single', '2026-08-09T00:00:04.000Z'),
  ];
  const result = new Map((await logs(captures, new Map([['child', analysis('child', 'root')]]))).map((item) => [item.id, item]));

  assert.equal(result.get('explicit-one')?.trace_id, 'session-one');
  assert.equal(result.get('explicit-one')?.trace_group_id, 'session-one');
  assert.equal(result.get('explicit-one')?.trace_group_source, 'explicit');
  assert.equal(result.get('explicit-two')?.trace_id, 'session-one');
  assert.equal(result.get('explicit-two')?.trace_group_id, 'session-one');
  assert.equal(result.get('explicit-two')?.trace_group_source, 'explicit');
  assert.equal(result.get('root')?.trace_group_id, 'root');
  assert.equal(result.get('root')?.trace_group_source, 'inferred');
  assert.equal(result.get('child')?.trace_group_id, 'root');
  assert.equal(result.get('child')?.trace_group_source, 'inferred');
  assert.equal(result.get('single')?.trace_group_id, undefined);
  assert.equal(result.get('single')?.trace_group_source, undefined);
});
