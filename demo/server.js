import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const demoDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(demoDir, 'public');
export const DEFAULT_DEMO_BASE_URL = 'http://127.0.0.1:8787';

export function parseBaseUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error('DEMO_BASE_URL must be a valid absolute URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('DEMO_BASE_URL must use http or https');
  if (/\/v1(?:\/messages)?\/?$/.test(url.pathname)) throw new Error('DEMO_BASE_URL must be a base URL without /v1');
  return url;
}

export function messagesUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/v1/messages`;
  url.search = '';
  url.hash = '';
  return url;
}

function numberOption(value, fallback, name) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < 0 || result > 65535) throw new Error(`${name} must be an integer from 0 to 65535`);
  return result;
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  response.end(body);
}

async function serveFile(response, filename, contentType) {
  try {
    const body = await readFile(path.join(publicDir, filename));
    response.writeHead(200, { 'content-type': contentType, 'content-length': body.length });
    response.end(body);
  } catch { json(response, 404, { error: 'Not found' }); }
}

function readJson(request, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Request body is too large'), { statusCode: 413 }));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 })); }
    });
    request.on('error', reject);
  });
}

function relayAgentChat(response, { messagesEndpoint, token, model, messages }) {
  const body = JSON.stringify({ model, max_tokens: 512, stream: true, messages });
  const headers = {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'anthropic-version': '2023-06-01',
    'x-api-key': token
  };

  const transport = messagesEndpoint.protocol === 'https:' ? https : http;
  const upstream = transport.request(messagesEndpoint, {
    method: 'POST',
    headers
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, {
      'content-type': upstreamResponse.headers['content-type'] || 'application/json',
      'cache-control': 'no-store'
    });
    upstreamResponse.pipe(response);
  });
  upstream.on('error', (error) => {
    if (response.headersSent) response.destroy(error);
    else json(response, 502, { error: 'Prompt Prism request failed', detail: error.message });
  });
  upstream.end(body);
}

export async function startDemo(options = {}) {
  const baseUrlValue = options.baseUrl ?? process.env.DEMO_BASE_URL ?? DEFAULT_DEMO_BASE_URL;
  const token = options.providerToken || process.env.DEMO_MODEL_PROVIDER_TOKEN;
  const model = options.model || process.env.DEMO_AGENT_MODEL;
  if (!token) throw new Error('Missing DEMO_MODEL_PROVIDER_TOKEN');
  if (!model) throw new Error('Missing DEMO_AGENT_MODEL');
  const messagesEndpoint = messagesUrl(parseBaseUrl(baseUrlValue));
  const requestedDemoPort = numberOption(options.demoPort ?? process.env.DEMO_PORT, 3000, 'DEMO_PORT');

  const demoServer = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/') return void serveFile(response, 'index.html', 'text/html; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/app.js') return void serveFile(response, 'app.js', 'text/javascript; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/api/config') return void json(response, 200, { model });
    if (request.method === 'POST' && url.pathname === '/api/chat') {
      readJson(request).then((body) => {
        const messages = Array.isArray(body.messages) ? body.messages.filter((item) =>
          item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string' && item.content.trim()) : [];
        if (!messages.length) return json(response, 400, { error: 'messages must contain at least one user or assistant message' });
        relayAgentChat(response, { messagesEndpoint, token, model, messages });
      }).catch((error) => json(response, error.statusCode || 400, { error: error.message }));
      return;
    }
    json(response, 404, { error: 'Not found' });
  });

  await new Promise((resolve, reject) => {
    demoServer.once('error', reject);
    demoServer.listen(requestedDemoPort, '127.0.0.1', resolve);
  });

  const demoPort = demoServer.address().port;
  const close = () => new Promise((resolve, reject) => demoServer.close((error) => error ? reject(error) : resolve()));
  return { demoServer, demoPort, model, close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const instance = await startDemo();
    console.log(`\n  Prompt Prism Agent Demo is running\n\n  Chat   http://127.0.0.1:${instance.demoPort}/\n  Model  ${instance.model}\n\n  Model traffic is routed through Prompt Prism.\n  Press Ctrl+C to stop.\n`);
  } catch (error) {
    console.error(`prompt-prism demo: ${error.message}`);
    process.exit(1);
  }
}
