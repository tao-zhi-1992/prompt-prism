import { readFile } from 'node:fs/promises';
import type http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Analysis, ApiFormatResolution, Capture, CaptureIndexEntry } from './types.js';
import type { BuiltinPluginRuntime } from './plugin-runtime.js';

const dashboardDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/dashboard');
const brandDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');
const brandFiles = new Set(['logo-mark.png', 'favicon-32.png', 'apple-touch-icon.png', 'favicon.ico']);
type TraceGroupSource = 'explicit' | 'inferred';
type TraceGroupMetadata = { trace_group_id: string; trace_group_source: TraceGroupSource };
type LogCursorPosition = { timestamp: string; id: string };
const DEFAULT_LOG_LIMIT = 100;
const MAX_LOG_LIMIT = 200;

export function json(response: http.ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  response.end(body);
}

function contentType(filename: string): string {
  if (filename.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filename.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filename.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filename.endsWith('.svg')) return 'image/svg+xml';
  if (filename.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

async function brandFile(response: http.ServerResponse, filename: string): Promise<void> {
  if (!brandFiles.has(filename)) return json(response, 404, { error: 'Not found' });
  try {
    const body = await readFile(path.join(brandDir, filename));
    response.writeHead(200, {
      'content-type': filename.endsWith('.ico') ? 'image/x-icon' : 'image/png',
      'content-length': body.length,
      'cache-control': 'public, max-age=31536000, immutable'
    });
    response.end(body);
  } catch { json(response, 404, { error: 'Not found' }); }
}

async function staticFile(response: http.ServerResponse, filename: string): Promise<void> {
  try {
    const absolute = path.resolve(dashboardDir, filename);
    if (!absolute.startsWith(`${dashboardDir}${path.sep}`)) return json(response, 404, { error: 'Not found' });
    const body = await readFile(absolute);
    response.writeHead(200, {
      'content-type': contentType(filename),
      'content-length': body.length,
      'cache-control': filename === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
    });
    response.end(body);
  } catch { json(response, 404, { error: 'Not found' }); }
}

function logSummary(capture: CaptureIndexEntry, analyzer: { analyses: Map<string, Analysis> }): Omit<CaptureIndexEntry, 'messages' | 'prompt_input'> & { analysis: Omit<Analysis, 'diff' | 'sections'> | null } {
  const { messages: _messages, prompt_input: _promptInput, ...summary } = capture;
  const analysis = analyzer.analyses.get(capture.id);
  if (!analysis) return { ...summary, analysis: null };
  const { diff: _diff, sections: _sections, ...analysisSummary } = analysis;
  return { ...summary, analysis: analysisSummary };
}

function inferredRootId(id: string, byId: Map<string, CaptureIndexEntry>, analyses: Map<string, Analysis>, roots: Map<string, string>): string {
  let current = id;
  const seen = new Set<string>();
  const path: string[] = [];
  while (!seen.has(current)) {
    const cached = roots.get(current);
    if (cached) {
      for (const item of path) roots.set(item, cached);
      return cached;
    }
    seen.add(current);
    path.push(current);
    const parentId = analyses.get(current)?.matched_parent_id;
    if (!parentId || !byId.has(parentId)) {
      for (const item of path) roots.set(item, current);
      return current;
    }
    current = parentId;
  }
  for (const item of path) roots.set(item, current);
  return current;
}

function buildTraceGroupMetadata(captures: readonly CaptureIndexEntry[], analyses: Map<string, Analysis>): Map<string, TraceGroupMetadata> {
  const byId = new Map(captures.map((capture) => [capture.id, capture]));
  const inferredRoots = new Map<string, string>();
  const inferredCounts = new Map<string, number>();
  for (const capture of captures) {
    if (capture.trace_id) continue;
    const rootId = inferredRootId(capture.id, byId, analyses, inferredRoots);
    inferredRoots.set(capture.id, rootId);
    inferredCounts.set(rootId, (inferredCounts.get(rootId) ?? 0) + 1);
  }

  const metadata = new Map<string, TraceGroupMetadata>();
  for (const capture of captures) {
    if (capture.trace_id) {
      metadata.set(capture.id, { trace_group_id: capture.trace_id, trace_group_source: 'explicit' });
      continue;
    }
    const rootId = inferredRoots.get(capture.id);
    if (rootId && (inferredCounts.get(rootId) ?? 0) > 1) metadata.set(capture.id, { trace_group_id: rootId, trace_group_source: 'inferred' });
  }
  return metadata;
}

function compareLogPosition(left: LogCursorPosition, right: LogCursorPosition): number {
  return right.timestamp.localeCompare(left.timestamp) || right.id.localeCompare(left.id);
}

export function encodeLogCursor(position: LogCursorPosition): string {
  return Buffer.from(JSON.stringify([position.timestamp, position.id])).toString('base64url');
}

export function decodeLogCursor(cursor: string): LogCursorPosition {
  if (!cursor || cursor.length > 2048) throw new Error('Invalid logs cursor');
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || Number.isNaN(Date.parse(value[0])) || typeof value[1] !== 'string' || !value[1]) throw new Error();
    return { timestamp: value[0], id: value[1] };
  } catch { throw new Error('Invalid logs cursor'); }
}

function firstOlderIndex(sorted: readonly CaptureIndexEntry[], cursor: LogCursorPosition): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compareLogPosition(sorted[middle]!, cursor) <= 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

function firstNotNewerIndex(sorted: readonly CaptureIndexEntry[], cursor: LogCursorPosition): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compareLogPosition(sorted[middle]!, cursor) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function createAdminHandler({
  store,
  analyzer,
  plugins,
  apiFormat,
}: {
  store: { captures: CaptureIndexEntry[]; readCapture(id: string): Promise<Capture | null>; clear(): Promise<void> };
  analyzer: { analyses: Map<string, Analysis> };
  plugins: Pick<BuiltinPluginRuntime, 'handleApi'>;
  apiFormat: () => ApiFormatResolution;
}): (request: http.IncomingMessage, response: http.ServerResponse) => Promise<void> {
  type LogSummary = ReturnType<typeof logSummary> & Partial<TraceGroupMetadata>;
  let cachedSignature = '';
  let cachedSorted: CaptureIndexEntry[] = [];
  let cachedSummaries = new Map<string, LogSummary>();
  let cachedPositions = new Map<string, number>();

  const logSnapshot = () => {
    const first = store.captures[0];
    const last = store.captures.at(-1);
    const signature = `${store.captures.length}:${first?.id ?? ''}:${last?.id ?? ''}:${analyzer.analyses.size}`;
    if (signature === cachedSignature) return { sorted: cachedSorted, summaries: cachedSummaries, positions: cachedPositions };
    const traceGroups = buildTraceGroupMetadata(store.captures, analyzer.analyses);
    cachedSorted = [...store.captures].sort(compareLogPosition);
    cachedPositions = new Map(cachedSorted.map((capture, index) => [capture.id, index]));
    cachedSummaries = new Map(cachedSorted.map((capture) => {
      const summary = logSummary(capture, analyzer);
      const group = traceGroups.get(capture.id);
      return [capture.id, group ? { ...summary, ...group } : summary];
    }));
    cachedSignature = signature;
    return { sorted: cachedSorted, summaries: cachedSummaries, positions: cachedPositions };
  };

  return async function handleAdmin(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (url.pathname === '/_pp/api/logs') {
      if (request.method === 'DELETE') {
        await store.clear();
        analyzer.analyses.clear();
        cachedSignature = '';
        return json(response, 200, { cleared: true });
      }
      if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
      const { sorted, summaries, positions } = logSnapshot();
      if (!url.search) return json(response, 200, sorted.map((capture) => summaries.get(capture.id)));
      if (url.searchParams.has('before') && url.searchParams.has('after')) return json(response, 400, { error: 'before and after are mutually exclusive' });
      const limitValue = url.searchParams.get('limit');
      const limit = limitValue === null ? DEFAULT_LOG_LIMIT : Number(limitValue);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LOG_LIMIT) return json(response, 400, { error: `limit must be between 1 and ${MAX_LOG_LIMIT}` });
      let entries: CaptureIndexEntry[];
      try {
        const before = url.searchParams.get('before');
        const after = url.searchParams.get('after');
        if (before !== null) {
          const start = firstOlderIndex(sorted, decodeLogCursor(before));
          entries = sorted.slice(start, start + limit);
        } else if (after !== null) {
          const end = firstNotNewerIndex(sorted, decodeLogCursor(after));
          entries = sorted.slice(Math.max(0, end - limit), end);
        } else entries = sorted.slice(0, limit);
      } catch (error) {
        return json(response, 400, { error: error instanceof Error ? error.message : 'Invalid logs cursor' });
      }
      const firstEntry = entries[0];
      const lastEntry = entries.at(-1);
      const firstIndex = firstEntry ? positions.get(firstEntry.id) ?? -1 : -1;
      const lastIndex = lastEntry ? positions.get(lastEntry.id) ?? -1 : -1;
      return json(response, 200, {
        items: entries.map((capture) => summaries.get(capture.id)),
        total: sorted.length,
        oldest_cursor: lastEntry ? encodeLogCursor(lastEntry) : null,
        newest_cursor: firstEntry ? encodeLogCursor(firstEntry) : null,
        has_older: lastIndex >= 0 && lastIndex < sorted.length - 1,
        has_newer: firstIndex > 0,
      });
    }
    if (url.pathname.startsWith('/_pp/api/logs/')) {
      if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
      const id = decodeURIComponent(url.pathname.slice('/_pp/api/logs/'.length));
      const summary = logSnapshot().summaries.get(id);
      return summary ? json(response, 200, summary) : json(response, 404, { error: 'Capture not found' });
    }
    if (url.pathname === '/_pp/api/config') {
      if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
      return json(response, 200, { api_format: apiFormat() });
    }
    if (url.pathname.startsWith('/_pp/api/')) {
      const pluginPath = url.pathname.slice('/_pp/api/'.length);
      const separator = pluginPath.indexOf('/');
      const pluginId = separator === -1 ? pluginPath : pluginPath.slice(0, separator);
      const subpath = separator === -1 ? '' : pluginPath.slice(separator + 1);
      if (pluginId && await plugins.handleApi(pluginId, request, response, subpath)) return;
      return json(response, 404, { error: 'Not found' });
    }
    if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
    if (url.pathname === '/_pp' || url.pathname === '/_pp/') return staticFile(response, 'index.html');
    if (url.pathname.startsWith('/_pp/brand/')) return brandFile(response, decodeURIComponent(url.pathname.slice('/_pp/brand/'.length)));
    if (url.pathname.startsWith('/_pp/assets/')) return staticFile(response, url.pathname.slice('/_pp/'.length));
    return json(response, 404, { error: 'Not found' });
  };
}
