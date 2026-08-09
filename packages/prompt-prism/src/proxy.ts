import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CaptureStore } from './store.js';
import { getProviderAdapter } from './adapter/registry.js';
import { ApiFormatResolver, detectProtocolFromBody, detectProtocolFromHeaders, detectProtocolFromPath, detectProtocolFromResponse, endpointPath, type DetectedProtocol } from './adapter/detection.js';
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

export function parseUpstreamBaseUrl(value: string | URL): URL {
  const upstreamUrl = parseUpstreamUrl(value);
  if (upstreamUrl.search) throw new Error('Upstream Base URL must not contain a query; use --upstream-url for an exact endpoint');
  if (detectProtocolFromPath(upstreamUrl.pathname)) throw new Error('Upstream Base URL must not include an API endpoint; use --upstream-url for a complete endpoint');
  upstreamUrl.pathname = upstreamUrl.pathname.replace(/\/+$/, '');
  return upstreamUrl;
}

function joinedTarget(baseUrl: URL, requestUrl: string | undefined, protocol: DetectedProtocol | null): URL {
  const incoming = new URL(requestUrl ?? '/', 'http://prompt-prism.local');
  const target = new URL(baseUrl);
  const suffix = protocol ? endpointPath(protocol) : incoming.pathname;
  target.pathname = `${baseUrl.pathname.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`;
  target.search = incoming.search;
  return target;
}

function shallowModel(body: Buffer): string | null {
  try {
    const value = JSON.parse(body.toString('utf8')) as { model?: unknown };
    return typeof value?.model === 'string' ? value.model : null;
  } catch { return null; }
}

function openBrowser(url: string): void {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
  child.on('error', () => {});
}

export async function createPromptPrism(options: PromptPrismOptions = {}): Promise<PromptPrismInstance> {
  if (options.upstreamBaseUrl !== undefined && options.upstreamUrl !== undefined) throw new Error('upstreamBaseUrl and upstreamUrl are mutually exclusive');
  const upstreamMode = options.upstreamUrl === undefined ? 'base' : 'exact';
  const upstreamUrl = upstreamMode === 'exact'
    ? parseUpstreamUrl(options.upstreamUrl!)
    : parseUpstreamBaseUrl(options.upstreamBaseUrl ?? 'https://api.anthropic.com');
  const resolver = new ApiFormatResolver(options.apiFormat ?? 'auto', upstreamUrl, upstreamMode === 'exact');
  const pathProtocol = upstreamMode === 'exact' ? detectProtocolFromPath(upstreamUrl.pathname) : null;
  if (resolver.resolution.mode === 'explicit' && pathProtocol && pathProtocol !== resolver.resolution.resolved) {
    console.warn(`[prompt-prism] API format ${resolver.resolution.resolved} conflicts with upstream endpoint ${pathProtocol}; using the explicit format.`);
  }
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
  const admin = createAdminHandler({ store, analyzer, plugins, apiFormat: () => ({ ...resolver.resolution }) });

  const server = http.createServer((request, response) => {
    if (serveRootBrandAsset(request, response)) return;
    if (request.url === '/_pp' || request.url?.startsWith('/_pp/')) {
      admin(request, response).catch((error: unknown) => { if (!response.headersSent) response.writeHead(500); response.end(error instanceof Error ? error.message : String(error)); });
      return;
    }

    const requestPath = new URL(request.url ?? '/', 'http://prompt-prism.local').pathname;
    resolver.consider(detectProtocolFromPath(requestPath), 'request-path');
    resolver.consider(detectProtocolFromHeaders(request.headers), 'request-headers');
    const routingProtocol = resolver.resolution.resolved ?? resolver.resolution.unsupported_protocol as DetectedProtocol | undefined ?? null;
    const targetUrl = upstreamMode === 'exact' ? upstreamUrl : joinedTarget(upstreamUrl, request.url, routingProtocol);
    const transport = targetUrl.protocol === 'https:' ? https : http;

    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    const requestChunks: Buffer[] = [];
    request.on('data', (chunk) => requestChunks.push(Buffer.from(chunk)));
    const upstream = transport.request({
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || undefined,
      method: request.method,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers: forwardedHeaders(request.headers, targetUrl)
    }, (upstreamResponse) => {
      const headersMs = Date.now();
      let firstByteMs: number | null = null;
      const responseChunks: Buffer[] = [];
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, responseHeaders(upstreamResponse.headers));
      upstreamResponse.on('data', (chunk) => {
        if (firstByteMs === null) firstByteMs = Date.now();
        responseChunks.push(Buffer.from(chunk));
      });
      upstreamResponse.on('end', () => {
        const completedMs = Date.now();
        const completedAt = new Date(completedMs).toISOString();
        const requestBody = Buffer.concat(requestChunks);
        const responseBody = Buffer.concat(responseChunks);
        resolver.consider(detectProtocolFromBody(requestBody), 'request-shape');
        resolver.consider(detectProtocolFromResponse(responseBody), 'response-shape');
        const adapter = resolver.resolution.resolved ? getProviderAdapter(resolver.resolution.resolved) : null;
        let parsedRequest = null;
        let parsedResponse = null;
        if (adapter) {
          try {
            parsedRequest = adapter.parseRequest(requestBody);
            parsedResponse = adapter.parseResponse(responseBody, upstreamResponse.headers['content-type']);
          } catch { /* Preserve a Raw-only capture when provider extensions cannot be normalized. */ }
        }
        const traceId = traceIdentity(request.headers);
        const capture: Capture = {
          id: crypto.randomUUID(),
          timestamp: completedAt,
          token_hash: tokenIdentity(request.headers),
          model: parsedRequest?.model ?? shallowModel(requestBody),
          messages: parsedRequest?.messages ?? [],
          adapter_id: adapter?.id ?? 'unresolved',
          ...(parsedRequest ? { prompt_input: parsedRequest.input } : {}),
          usage: parsedResponse?.usage ?? {},
          ...(parsedResponse?.output ? { model_output: parsedResponse.output } : {}),
          ...(traceId ? { trace_id: traceId } : {}),
          upstream_host: targetUrl.host,
          timing: {
            started_at: startedAt,
            completed_at: completedAt,
            duration_ms: completedMs - startedMs,
            time_to_headers_ms: headersMs - startedMs,
            time_to_first_byte_ms: firstByteMs === null ? null : firstByteMs - startedMs,
          },
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

  return { server, store, analyzer, upstreamUrl, upstreamMode, apiFormat: resolver.resolution };
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
  const format = instance.apiFormat.resolved
    ? `${instance.apiFormat.mode === 'auto' ? 'Auto → ' : ''}${instance.apiFormat.resolved}${instance.apiFormat.source ? ` (${instance.apiFormat.source})` : ''}`
    : instance.apiFormat.unsupported_protocol ? `Auto → ${instance.apiFormat.unsupported_protocol} (unsupported; Raw only)` : 'Auto · waiting for first request';
  console.log(`\n  Prompt Prism is running\n\n  Proxy          http://127.0.0.1:${port}\n  Dashboard      ${dashboard}\n  Upstream ${instance.upstreamMode === 'base' ? 'Base' : 'URL '} ${instance.upstreamUrl.href}\n  API format     ${format}\n\n  Point your model client base URL at the Proxy address.\n  Press Ctrl+C to stop.\n`);
  if (options.open !== false) openBrowser(dashboard);
  return { ...instance, port, dashboard };
}
