import type http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminHandler, decodeLogCursor, encodeLogCursor } from '../../src/server.js';
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

async function adminRequest(
  url: string,
  captures: CaptureIndexEntry[],
  analyses = new Map<string, Analysis>(),
  options: { method?: string; clear?: () => Promise<void> } = {},
): Promise<{ status: number; body: unknown }> {
  let body: unknown;
  let status = 0;
  const response = {
    writeHead: (value: number) => { status = value; return response; },
    end: (value: string) => { body = JSON.parse(value) as unknown; },
  } as unknown as http.ServerResponse;
  const apiFormat = (): ApiFormatResolution => ({ mode: 'auto', configured: 'auto', resolved: null, source: null });
  const handler = createAdminHandler({
    store: { captures, readCapture: async () => null, clear: options.clear ?? (async () => {}) },
    analyzer: { analyses },
    plugins: { handleApi: async () => false },
    apiFormat,
    dynamicUpstreamAllowed: () => true,
    proxyUrlPath: () => '/_proxy/test',
  });
  await handler({ method: options.method ?? 'GET', url } as http.IncomingMessage, response);
  return { status, body };
}

async function logs(captures: CaptureIndexEntry[], analyses: Map<string, Analysis>): Promise<Array<Record<string, unknown>>> {
  return (await adminRequest('/_pp/api/logs', captures, analyses)).body as Array<Record<string, unknown>>;
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
  assert.equal(result.get('explicit-one')?.trace_group_index, 1);
  assert.equal(result.get('explicit-two')?.trace_id, 'session-one');
  assert.equal(result.get('explicit-two')?.trace_group_id, 'session-one');
  assert.equal(result.get('explicit-two')?.trace_group_source, 'explicit');
  assert.equal(result.get('explicit-two')?.trace_group_index, 2);
  assert.equal(result.get('root')?.trace_group_id, 'root');
  assert.equal(result.get('root')?.trace_group_source, 'inferred');
  assert.equal(result.get('root')?.trace_group_index, 1);
  assert.equal(result.get('child')?.trace_group_id, 'root');
  assert.equal(result.get('child')?.trace_group_source, 'inferred');
  assert.equal(result.get('child')?.trace_group_index, 2);
  assert.equal(result.get('single')?.trace_group_id, undefined);
  assert.equal(result.get('single')?.trace_group_source, undefined);
  assert.equal(result.get('single')?.trace_group_index, undefined);
});

test('paginates logs with stable opaque cursors while preserving the legacy array response', async () => {
  const captures = [
    entry('old', '2026-08-09T00:00:00.000Z'),
    entry('same-a', '2026-08-09T00:00:01.000Z'),
    entry('same-b', '2026-08-09T00:00:01.000Z'),
    entry('new', '2026-08-09T00:00:02.000Z'),
  ];
  const legacy = await adminRequest('/_pp/api/logs', captures);
  assert.equal(legacy.status, 200);
  assert.deepEqual((legacy.body as Array<{ id: string }>).map(({ id }) => id), ['new', 'same-b', 'same-a', 'old']);

  const first = await adminRequest('/_pp/api/logs?limit=2', captures);
  assert.equal(first.status, 200);
  const firstPage = first.body as { items: Array<{ id: string }>; total: number; oldest_cursor: string; newest_cursor: string; has_older: boolean; has_newer: boolean };
  assert.deepEqual(firstPage.items.map(({ id }) => id), ['new', 'same-b']);
  assert.equal(firstPage.total, 4);
  assert.equal(firstPage.has_older, true);
  assert.equal(firstPage.has_newer, false);
  assert.deepEqual(decodeLogCursor(firstPage.newest_cursor), { timestamp: '2026-08-09T00:00:02.000Z', id: 'new' });

  const second = await adminRequest(`/_pp/api/logs?limit=2&before=${encodeURIComponent(firstPage.oldest_cursor)}`, captures);
  const secondPage = second.body as typeof firstPage;
  assert.deepEqual(secondPage.items.map(({ id }) => id), ['same-a', 'old']);
  assert.equal(secondPage.has_older, false);
  assert.equal(secondPage.has_newer, true);
});

test('after cursors page through bursts without gaps and remain valid after their capture disappears', async () => {
  const cursor = encodeLogCursor({ timestamp: '2026-08-09T00:00:00.000Z', id: 'removed-cursor-capture' });
  const captures = Array.from({ length: 5 }, (_, index) => entry(`new-${index}`, `2026-08-09T00:00:0${index + 1}.000Z`));
  const found: string[] = [];
  let after = cursor;
  let hasNewer = true;
  while (hasNewer) {
    const result = await adminRequest(`/_pp/api/logs?limit=2&after=${encodeURIComponent(after)}`, captures);
    const page = result.body as { items: Array<{ id: string }>; newest_cursor: string | null; has_newer: boolean };
    found.push(...page.items.map(({ id }) => id));
    hasNewer = page.has_newer;
    if (page.newest_cursor) after = page.newest_cursor;
  }
  assert.deepEqual(new Set(found), new Set(captures.map(({ id }) => id)));
  assert.equal(found.length, captures.length);
});

test('validates log pagination and serves summaries by id', async () => {
  const captures = [entry('capture/id', '2026-08-09T00:00:00.000Z')];
  for (const url of [
    '/_pp/api/logs?limit=0',
    '/_pp/api/logs?limit=201',
    '/_pp/api/logs?before=bad&after=also-bad',
    '/_pp/api/logs?before=',
    '/_pp/api/logs?before=not-a-cursor',
  ]) assert.equal((await adminRequest(url, captures)).status, 400);

  const detail = await adminRequest('/_pp/api/logs/capture%2Fid', captures);
  assert.equal(detail.status, 200);
  assert.equal((detail.body as { id: string }).id, 'capture/id');
  assert.equal((await adminRequest('/_pp/api/logs/missing', captures)).status, 404);
  assert.throws(() => decodeLogCursor('invalid'), /Invalid logs cursor/);
});

test('returns stable JSON responses when clearing captures succeeds or fails', async () => {
  const captures = [entry('capture', '2026-08-09T00:00:00.000Z')];
  const success = await adminRequest('/_pp/api/logs', captures, new Map(), { method: 'DELETE' });
  assert.deepEqual(success, { status: 200, body: { cleared: true } });

  const failure = await adminRequest('/_pp/api/logs', captures, new Map(), {
    method: 'DELETE', clear: async () => { throw new Error('private failure'); },
  });
  assert.deepEqual(failure, { status: 500, body: { error: 'Failed to clear captures' } });
});
