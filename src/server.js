import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  response.end(body);
}

async function staticFile(response, filename, contentType) {
  try {
    const body = await readFile(path.join(publicDir, filename));
    response.writeHead(200, { 'content-type': contentType, 'content-length': body.length });
    response.end(body);
  } catch { json(response, 404, { error: 'Not found' }); }
}

export function createAdminHandler({ store, analyzer }) {
  return async function handleAdmin(request, response) {
    const url = new URL(request.url, 'http://localhost');
    if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });

    if (url.pathname === '/_pp/api/logs') {
      const logs = store.captures.map((capture) => ({ ...capture, analysis: analyzer.analyses.get(capture.id) ?? null }))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      return json(response, 200, logs);
    }
    if (url.pathname.startsWith('/_pp/api/diff/')) {
      const id = decodeURIComponent(url.pathname.slice('/_pp/api/diff/'.length));
      const analysis = analyzer.analyses.get(id);
      if (!analysis) return json(response, 404, { error: 'Capture not found' });
      return json(response, 200, analysis);
    }
    if (url.pathname === '/_pp' || url.pathname === '/_pp/') return staticFile(response, 'index.html', 'text/html; charset=utf-8');
    if (url.pathname === '/_pp/app.js') return staticFile(response, 'app.js', 'text/javascript; charset=utf-8');
    return json(response, 404, { error: 'Not found' });
  };
}
