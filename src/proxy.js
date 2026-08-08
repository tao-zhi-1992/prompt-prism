import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { CaptureStore } from './store.js';
import { Analyzer } from './analyzer.js';
import anthropic from './adapter/anthropic.js';
import { createAdminHandler } from './server.js';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const SENSITIVE = /^(authorization|proxy-authorization|x-api-key|api-key|cookie|set-cookie)$/i;

function forwardedHeaders(headers, upstreamUrl) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) if (!HOP_BY_HOP.has(name.toLowerCase())) result[name] = value;
  result.host = upstreamUrl.host;
  return result;
}

function responseHeaders(headers) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) if (!HOP_BY_HOP.has(name.toLowerCase())) result[name] = value;
  return result;
}

function redactedHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, SENSITIVE.test(name) ? '[REDACTED]' : value]));
}

function tokenIdentity(headers) {
  const secret = headers['x-api-key'] || headers.authorization || headers['api-key'] || 'anonymous';
  return crypto.createHash('sha256').update(String(secret)).digest('hex').slice(0, 16);
}

export function parseUpstreamUrl(value) {
  let upstreamUrl;
  try { upstreamUrl = new URL(value); }
  catch { throw new Error('Upstream URL must be a valid absolute URL'); }
  if (!['http:', 'https:'].includes(upstreamUrl.protocol)) throw new Error('Upstream URL must use http or https');
  if (upstreamUrl.hash) throw new Error('Upstream URL must not contain a fragment');
  return upstreamUrl;
}

function openBrowser(url) {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
  child.on('error', () => {});
}

export async function createPromptPrism(options = {}) {
  const upstreamUrl = parseUpstreamUrl(options.upstreamUrl ?? 'https://api.anthropic.com/v1/messages');
  const store = await new CaptureStore({ dataDir: options.dataDir ?? path.resolve('data'), maxBytes: options.maxBytes }).init();
  const analyzer = new Analyzer({ analysisPath: store.analysisPath });
  await analyzer.init(store.captures);
  store.onEvict = (item) => analyzer.remove(item.id, item.token_hash);
  const admin = createAdminHandler({ store, analyzer });
  const transport = upstreamUrl.protocol === 'https:' ? https : http;

  const server = http.createServer((request, response) => {
    if (request.url === '/_pp' || request.url.startsWith('/_pp/')) {
      admin(request, response).catch((error) => { if (!response.headersSent) response.writeHead(500); response.end(error.message); });
      return;
    }

    const requestChunks = [];
    request.on('data', (chunk) => requestChunks.push(Buffer.from(chunk)));
    const upstream = transport.request({
      protocol: upstreamUrl.protocol,
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port || undefined,
      method: request.method,
      path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
      headers: forwardedHeaders(request.headers, upstreamUrl)
    }, (upstreamResponse) => {
      const responseChunks = [];
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, responseHeaders(upstreamResponse.headers));
      upstreamResponse.on('data', (chunk) => responseChunks.push(Buffer.from(chunk)));
      upstreamResponse.on('end', () => {
        const requestBody = Buffer.concat(requestChunks);
        const responseBody = Buffer.concat(responseChunks);
        let parsedRequest;
        try { parsedRequest = anthropic.parseRequest(requestBody); }
        catch { return; }
        const { usage } = anthropic.parseResponse(responseBody, upstreamResponse.headers['content-type']);
        const capture = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          token_hash: tokenIdentity(request.headers),
          model: parsedRequest.model,
          messages: parsedRequest.messages,
          usage,
          request: { method: request.method, url: request.url, headers: redactedHeaders(request.headers), body: requestBody.toString('utf8') },
          response: { status: upstreamResponse.statusCode, headers: redactedHeaders(upstreamResponse.headers), body: responseBody.toString('utf8') }
        };
        setImmediate(() => store.enqueue(capture, (stored) => analyzer.analyze({ ...capture, ...stored })).catch(() => {}));
      });
      upstreamResponse.on('error', (error) => response.destroy(error));
      // pipe() applies downstream backpressure while the data listener above only
      // takes a side-channel copy for analysis.
      upstreamResponse.pipe(response);
    });
    upstream.on('error', (error) => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Upstream request failed', detail: error.message }));
    });
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
  });

  return { server, store, analyzer, upstreamUrl };
}

export async function startPromptPrism(options = {}) {
  const instance = await createPromptPrism(options);
  const requestedPort = options.port ?? 8787;
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(requestedPort, options.host ?? '127.0.0.1', resolve);
  });
  const address = instance.server.address();
  const port = typeof address === 'object' ? address.port : requestedPort;
  const dashboard = `http://127.0.0.1:${port}/_pp/`;
  console.log(`\n  Prompt Prism is running\n\n  Proxy        http://127.0.0.1:${port}\n  Dashboard    ${dashboard}\n  Upstream URL ${instance.upstreamUrl.href}\n\n  Point your Anthropic base URL at the Proxy address.\n  Press Ctrl+C to stop.\n`);
  if (options.open !== false) openBrowser(dashboard);
  return { ...instance, port, dashboard };
}
