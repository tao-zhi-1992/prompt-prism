import { readFile } from 'node:fs/promises';
import type http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProviderAdapter } from './adapter/registry.js';
import type { ApiFormatResolution, Capture, CaptureIndexEntry } from './types.js';
import type { TraceService } from './trace-service.js';
import type { ServerPluginRuntime } from './plugins.js';

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.basename(runtimeDir) === 'dist'
  ? path.resolve(runtimeDir, '..')
  : path.basename(path.dirname(runtimeDir)) === 'core'
    ? path.resolve(runtimeDir, '../../prompt-prism')
    : path.resolve(runtimeDir, '../..');
const dashboardDir = path.join(packageDir, 'public/dashboard');
const brandDir = path.join(packageDir, 'assets');
const brandFiles = new Set(['logo-mark.png', 'favicon-32.png', 'apple-touch-icon.png', 'favicon.ico']);
type LogCursorPosition = { timestamp: string; id: string };
const DEFAULT_LOG_LIMIT = 100;
const MAX_LOG_LIMIT = 200;
const MAX_JSON_BODY_BYTES = 16 * 1024;

export function json(response: http.ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  response.end(body);
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Request body must be valid JSON'); }
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

function logSummary(capture: CaptureIndexEntry): Omit<CaptureIndexEntry, 'messages' | 'prompt_input'> & { analysis: null } {
  const { messages: _messages, prompt_input: _promptInput, ...summary } = capture;
  return { ...summary, analysis: null };
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
  trace,
  plugins,
  apiFormat,
  dynamicUpstreamAllowed,
  proxyUrlPath,
}: {
  store: { captures: CaptureIndexEntry[]; readCapture(id: string): Promise<Capture | null>; clear(): Promise<void> };
  trace: TraceService;
  plugins: Pick<ServerPluginRuntime, 'handleApi'>;
  apiFormat: () => ApiFormatResolution;
  dynamicUpstreamAllowed: () => boolean;
  proxyUrlPath: (upstreamBaseUrl: string) => string;
}): ((request: http.IncomingMessage, response: http.ServerResponse) => Promise<void>) & { refresh(): void } {
  type LogSummary = ReturnType<typeof logSummary> & Partial<ReturnType<TraceService['metadata']> extends Map<string, infer Metadata> ? Metadata : never>;
  let cachedSignature = '';
  let revision = 0;
  let previousSummaries = new Map<string, LogSummary>();
  const changes: Array<{ revision: number; added: LogSummary[]; updated: LogSummary[]; removed_ids: string[]; total: number }> = [];
  const listeners = new Set<http.ServerResponse>();
  let cachedSorted: CaptureIndexEntry[] = [];
  let cachedSummaries = new Map<string, LogSummary>();
  let cachedPositions = new Map<string, number>();

  const logSnapshot = () => {
    const captureSignature = store.captures.map((capture) => JSON.stringify([
      capture.id,
      capture.timestamp,
      capture.token_hash,
      capture.model,
      capture.usage,
      capture.response_status,
      capture.upstream_host,
      capture.trace_id,
      capture.timing,
      capture.file_ref,
    ])).join('\x01');
    const traceSignature = store.captures.map((capture) => `${capture.id}\0${trace.getParentId(capture.id) ?? ''}`).join('\x01');
    const signature = `${captureSignature}|${traceSignature}`;
    if (signature === cachedSignature) return { sorted: cachedSorted, summaries: cachedSummaries, positions: cachedPositions };
    const traceGroups = trace.metadata(store.captures);
    cachedSorted = [...store.captures].sort(compareLogPosition);
    cachedPositions = new Map(cachedSorted.map((capture, index) => [capture.id, index]));
    cachedSummaries = new Map(cachedSorted.map((capture) => {
      const summary = logSummary(capture);
      const group = traceGroups.get(capture.id);
      return [capture.id, group ? { ...summary, ...group } : summary];
    }));
    cachedSignature = signature;
    const added: LogSummary[] = [];
    const updated: LogSummary[] = [];
    for (const [id, summary] of cachedSummaries) {
      const previous = previousSummaries.get(id);
      if (!previous) added.push(summary);
      else if (JSON.stringify(previous) !== JSON.stringify(summary)) updated.push(summary);
    }
    const removed_ids = [...previousSummaries.keys()].filter((id) => !cachedSummaries.has(id));
    if (added.length || updated.length || removed_ids.length) {
      revision++;
      const change = { revision, added, updated, removed_ids, total: cachedSorted.length };
      changes.push(change);
      if (changes.length > 256) changes.shift();
      for (const response of listeners) {
        response.write(`id: ${revision}\nevent: change\ndata: ${JSON.stringify(change)}\n\n`);
      }
    }
    previousSummaries = new Map(cachedSummaries);
    return { sorted: cachedSorted, summaries: cachedSummaries, positions: cachedPositions };
  };

  const handleAdmin = async function handleAdmin(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (url.pathname === '/_pp/api/logs/stream') {
      if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
      logSnapshot();
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const since = Number(request.headers['last-event-id'] ?? url.searchParams.get('since') ?? 0);
      if (!Number.isInteger(since) || since < 0 || (changes.length && since < changes[0]!.revision - 1)) response.write(`event: reset\ndata: ${JSON.stringify({ revision })}\n\n`);
      else for (const change of changes.filter((item) => item.revision > since)) response.write(`id: ${change.revision}\nevent: change\ndata: ${JSON.stringify(change)}\n\n`);
      const heartbeat = setInterval(() => response.write(': ping\n\n'), 15000);
      listeners.add(response);
      request.on('close', () => { clearInterval(heartbeat); listeners.delete(response); });
      return;
    }
    if (url.pathname === '/_pp/api/logs/changes') {
      if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
      logSnapshot();
      const since = Number(url.searchParams.get('since') ?? '');
      if (!Number.isInteger(since) || since < 0) return json(response, 400, { error: 'Invalid revision' });
      if (changes.length && since < changes[0]!.revision - 1) return json(response, 200, { reset_required: true, revision });
      return json(response, 200, { revision, changes: changes.filter((item) => item.revision > since) });
    }

    if (url.pathname === '/_pp/api/logs') {
      if (request.method === 'DELETE') {
        try {
          await store.clear();
          cachedSignature = '';
          return json(response, 200, { cleared: true });
        } catch {
          cachedSignature = '';
          return json(response, 500, { error: 'Failed to clear captures' });
        }
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
        revision,
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
    if (url.pathname === '/_pp/api/proxy-url') {
      if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed' });
      if (!dynamicUpstreamAllowed()) return json(response, 403, { error: 'Dynamic upstreams are disabled for non-loopback listeners' });
      try {
        const body = await readJsonBody(request) as { upstream_base_url?: unknown } | null;
        if (!body || typeof body !== 'object' || typeof body.upstream_base_url !== 'string') throw new Error('upstream_base_url must be a string');
        return json(response, 200, { path: proxyUrlPath(body.upstream_base_url) });
      } catch (error) {
        return json(response, 400, { error: error instanceof Error ? error.message : 'Invalid upstream Base URL' });
      }
    }
    if (url.pathname.startsWith('/_pp/api/trace/')) {
      if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
      const result = await trace.result(
        decodeURIComponent(url.pathname.slice('/_pp/api/trace/'.length)),
        store.captures,
        (id) => store.readCapture(id),
        (adapterId, body) => getProviderAdapter(adapterId).parseRequest(body),
        (adapterId, body, contentType) => getProviderAdapter(adapterId).parseResponse(body, contentType),
      );
      return result ? json(response, 200, result) : json(response, 404, { error: 'Capture not found' });
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
  handleAdmin.refresh = () => { logSnapshot(); };
  return handleAdmin;
}
