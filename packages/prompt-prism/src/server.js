import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dashboardDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/dashboard');
const brandDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');
const brandFiles = new Set(['logo-mark.png', 'favicon-32.png', 'apple-touch-icon.png', 'favicon.ico']);

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  response.end(body);
}

function contentType(filename) {
  if (filename.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filename.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filename.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filename.endsWith('.svg')) return 'image/svg+xml';
  if (filename.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

async function brandFile(response, filename) {
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

async function staticFile(response, filename) {
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

function logSummary(capture, analyzer) {
  const { messages: _messages, ...summary } = capture;
  const analysis = analyzer.analyses.get(capture.id);
  if (!analysis) return { ...summary, analysis: null };
  const { diff: _diff, ...analysisSummary } = analysis;
  return { ...summary, analysis: analysisSummary };
}

export function createAdminHandler({ store, analyzer }) {
  return async function handleAdmin(request, response) {
    const url = new URL(request.url, 'http://localhost');
    if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });

    if (url.pathname === '/_pp/api/logs') {
      const logs = store.captures.map((capture) => logSummary(capture, analyzer))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      return json(response, 200, logs);
    }
    if (url.pathname.startsWith('/_pp/api/diff/')) {
      const id = decodeURIComponent(url.pathname.slice('/_pp/api/diff/'.length));
      const analysis = analyzer.analyses.get(id);
      if (!analysis) return json(response, 404, { error: 'Capture not found' });
      return json(response, 200, analysis);
    }
    if (url.pathname.startsWith('/_pp/api/raw/')) {
      const id = decodeURIComponent(url.pathname.slice('/_pp/api/raw/'.length));
      const capture = await store.readCapture(id);
      if (!capture) return json(response, 404, { error: 'Capture not found' });
      return json(response, 200, {
        request: capture.request ?? null,
        response: capture.response ?? null
      });
    }
    if (url.pathname === '/_pp' || url.pathname === '/_pp/') return staticFile(response, 'index.html');
    if (url.pathname.startsWith('/_pp/brand/')) return brandFile(response, decodeURIComponent(url.pathname.slice('/_pp/brand/'.length)));
    if (url.pathname.startsWith('/_pp/assets/')) return staticFile(response, url.pathname.slice('/_pp/'.length));
    return json(response, 404, { error: 'Not found' });
  };
}
