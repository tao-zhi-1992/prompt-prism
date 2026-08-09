import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CaptureStore } from './store.js';
import { getProviderAdapter } from './adapter/registry.js';
import { createAdminHandler, json } from './server.js';
import { loadBuiltinPluginRuntime } from './plugin-runtime.js';
import type { Capture, PromptPrismInstance, PromptPrismOptions, RawHeaders, StartedPromptPrism } from './types.js';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const INTERNAL_HEADERS = new Set(['x-prompt-prism-trace-id']);
const SENSITIVE = /^(authorization|proxy-authorization|x-api-key|api-key|cookie|set-cookie)$/i;
const TRACE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const rootBrandFiles = new Map([
  ['/favicon.ico', { file: 'favicon.ico', contentType: 'image/x-icon' }],
  ['/apple-touch-icon.png', { file: 'apple-touch-icon.png', contentType: 'image/png' }]
]);

function serveRootBrandAsset(request: http.IncomingMessage, response: http.ServerResponse): boolean {
  const asset = request.method === 'GET' && request.url ? rootBrandFiles.get(request.url) : null;
  if (!asset) return false;
  const absolute = path.resolve(path.dirname(new URL(import.meta.url).pathname), `../assets/${asset.file}`);
  readFile(absolute).then((body) => {
    response.writeHead(200, {
      'content-type': asset.contentType,
      'content-length': body.length,
      'cache-control': 'public, max-age=31536000, immutable'
    });
    response.end(body);
  }).catch(() => {
    response.writeHead(404);
    response.end();
  });
  return true;
}

function forwardedHeaders(headers: http.IncomingHttpHeaders, upstreamUrl: URL): http.OutgoingHttpHeaders {
  const result: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name.toLowerCase()) && !INTERNAL_HEADERS.has(name.toLowerCase())) result[name] = value;
  }
  result.host = upstreamUrl.host;
  return result;
}

function responseHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const result: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) if (!HOP_BY_HOP.has(name.toLowerCase())) result[name] = value;
  return result;
}

function redactedHeaders(headers: http.IncomingHttpHeaders): RawHeaders {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, SENSITIVE.test(name) ? '[REDACTED]' : value]));
}

function tokenIdentity(headers: http.IncomingHttpHeaders): string {
  const secret = headers['x-api-key'] || headers.authorization || headers['api-key'] || 'anonymous';
  return crypto.createHash('sha256').update(String(secret)).digest('hex').slice(0, 16);
}

function traceIdentity(headers: http.IncomingHttpHeaders): string | undefined {
  const value = headers['x-prompt-prism-trace-id'];
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'string' && TRACE_ID.test(candidate) ? candidate : undefined;
}

export function parseUpstreamUrl(value: string | URL): URL {
  let upstreamUrl;
  try { upstreamUrl = new URL(value); }
  catch { throw new Error('Upstream URL must be a valid absolute URL'); }
  if (!['http:', 'https:'].includes(upstreamUrl.protocol)) throw new Error('Upstream URL must use http or https');
  if (upstreamUrl.hash) throw new Error('Upstream URL must not contain a fragment');
  return upstreamUrl;
}

function openBrowser(url: string): void {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
  child.on('error', () => {});
}

export async function createPromptPrism(options: PromptPrismOptions = {}): Promise<PromptPrismInstance> {
  const upstreamUrl = parseUpstreamUrl(options.upstreamUrl ?? 'https://api.anthropic.com/v1/messages');
  const adapter = getProviderAdapter(options.apiFormat);
  const store = await new CaptureStore({ dataDir: options.dataDir ?? path.resolve('data'), maxBytes: options.maxBytes }).init();
  const plugins = await loadBuiltinPluginRuntime();
  await plugins.init({
    analysisPath: store.analysisPath,
    captures: store.captures,
    readCapture: (id) => store.readCapture(id),
    parseProviderRequest: (adapterId, body) => getProviderAdapter(adapterId).parseRequest(body),
    parseProviderResponse: (adapterId, body, contentType) => getProviderAdapter(adapterId).parseResponse(body, contentType),
    json,
    reportError: (pluginId, error) => console.error(`[prompt-prism:${pluginId}]`, error instanceof Error ? error.message : String(error)),
  });
  const analyzer = plugins.analyzer;
  store.onEvict = (item) => plugins.onEvict(item);
  const admin = createAdminHandler({ store, analyzer, plugins });
  const transport = upstreamUrl.protocol === 'https:' ? https : http;

  const server = http.createServer((request, response) => {
    if (serveRootBrandAsset(request, response)) return;
    if (request.url === '/_pp' || request.url?.startsWith('/_pp/')) {
      admin(request, response).catch((error: unknown) => { if (!response.headersSent) response.writeHead(500); response.end(error instanceof Error ? error.message : String(error)); });
      return;
    }

    const requestChunks: Buffer[] = [];
    request.on('data', (chunk) => requestChunks.push(Buffer.from(chunk)));
    const upstream = transport.request({
      protocol: upstreamUrl.protocol,
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port || undefined,
      method: request.method,
      path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
      headers: forwardedHeaders(request.headers, upstreamUrl)
    }, (upstreamResponse) => {
      const responseChunks: Buffer[] = [];
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, responseHeaders(upstreamResponse.headers));
      upstreamResponse.on('data', (chunk) => responseChunks.push(Buffer.from(chunk)));
      upstreamResponse.on('end', () => {
        const requestBody = Buffer.concat(requestChunks);
        const responseBody = Buffer.concat(responseChunks);
        let parsedRequest;
        try { parsedRequest = adapter.parseRequest(requestBody); }
        catch { return; }
        const parsedResponse = adapter.parseResponse(responseBody, upstreamResponse.headers['content-type']);
        const traceId = traceIdentity(request.headers);
        const capture: Capture = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          token_hash: tokenIdentity(request.headers),
          model: parsedRequest.model,
          messages: parsedRequest.messages,
          adapter_id: adapter.id,
          prompt_input: parsedRequest.input,
          usage: parsedResponse.usage,
          ...(parsedResponse.output ? { model_output: parsedResponse.output } : {}),
          ...(traceId ? { trace_id: traceId } : {}),
          upstream_host: upstreamUrl.host,
          request: { method: request.method ?? 'GET', url: request.url ?? '/', headers: redactedHeaders(request.headers), body: requestBody.toString('utf8') },
          response: { status: upstreamResponse.statusCode ?? null, headers: redactedHeaders(upstreamResponse.headers), body: responseBody.toString('utf8') }
        };
        setImmediate(() => store.enqueue(capture, (stored) => plugins.onCapture({ ...capture, ...stored }, stored)).catch(() => {}));
      });
      upstreamResponse.on('error', (error) => response.destroy(error));
      // pipe() applies downstream backpressure while the data listener above only
      // takes a side-channel copy for analysis.
      upstreamResponse.pipe(response);
    });
    upstream.on('error', (error: Error) => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Upstream request failed', detail: error.message }));
    });
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
  });

  return { server, store, analyzer, upstreamUrl, apiFormat: adapter.id };
}

export async function startPromptPrism(options: PromptPrismOptions = {}): Promise<StartedPromptPrism> {
  const instance = await createPromptPrism(options);
  const requestedPort = options.port ?? 8787;
  await new Promise<void>((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(requestedPort, options.host ?? '127.0.0.1', resolve);
  });
  const address = instance.server.address();
  const port = address && typeof address === 'object' ? address.port : requestedPort;
  const dashboard = `http://127.0.0.1:${port}/_pp/`;
  console.log(`\n  Prompt Prism is running\n\n  Proxy        http://127.0.0.1:${port}\n  Dashboard    ${dashboard}\n  Upstream URL ${instance.upstreamUrl.href}\n  API format   ${instance.apiFormat}\n\n  Point your model client base URL at the Proxy address.\n  Press Ctrl+C to stop.\n`);
  if (options.open !== false) openBrowser(dashboard);
  return { ...instance, port, dashboard };
}
