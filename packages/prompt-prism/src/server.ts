import { readFile } from 'node:fs/promises';
import type http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Analysis, ApiFormatResolution, Capture, CaptureIndexEntry } from './types.js';
import type { BuiltinPluginRuntime } from './plugin-runtime.js';

const dashboardDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/dashboard');
const brandDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');
const brandFiles = new Set(['logo-mark.png', 'favicon-32.png', 'apple-touch-icon.png', 'favicon.ico']);

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

export function createAdminHandler({
  store,
  analyzer,
  plugins,
  apiFormat,
}: {
  store: { captures: CaptureIndexEntry[]; readCapture(id: string): Promise<Capture | null> };
  analyzer: { analyses: Map<string, Analysis> };
  plugins: Pick<BuiltinPluginRuntime, 'handleApi'>;
  apiFormat: () => ApiFormatResolution;
}): (request: http.IncomingMessage, response: http.ServerResponse) => Promise<void> {
  return async function handleAdmin(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (url.pathname === '/_pp/api/logs') {
      if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
      const logs = store.captures.map((capture) => logSummary(capture, analyzer))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return json(response, 200, logs);
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
