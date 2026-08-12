import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CaptureStore } from './store.js';
import { getProviderAdapter } from './adapter/registry.js';
import { ApiFormatResolver, detectProtocolFromPath } from './adapter/detection.js';
import { createAdminHandler, json } from './server.js';
import { loadBuiltinPluginRuntime } from './plugin-runtime.js';
import { buildDynamicProxyBaseUrl, DYNAMIC_UPSTREAM_PREFIX, parseDynamicUpstreamRoute, parseUpstreamBaseUrl, parseUpstreamUrl } from './upstream.js';
import { buildCapture } from './capture.js';
import { isLoopbackListener, resolveProxyTarget } from './proxy-target.js';
import type { PromptPrismInstance, PromptPrismOptions, StartedPromptPrism } from './types.js';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const INTERNAL_HEADERS = new Set(['x-prompt-prism-trace-id']);
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

export { parseUpstreamBaseUrl, parseUpstreamUrl } from './upstream.js';

function openBrowser(url: string): void {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
  child.on('error', () => {});
}

export async function createPromptPrism(options: PromptPrismOptions = {}): Promise<PromptPrismInstance> {
  if (options.upstreamBaseUrl !== undefined && options.upstreamUrl !== undefined) throw new Error('upstreamBaseUrl and upstreamUrl are mutually exclusive');
  const upstreamMode = options.upstreamUrl !== undefined ? 'exact' : options.upstreamBaseUrl !== undefined ? 'base' : 'none';
  const upstreamUrl = upstreamMode === 'exact'
    ? parseUpstreamUrl(options.upstreamUrl!)
    : upstreamMode === 'base' ? parseUpstreamBaseUrl(options.upstreamBaseUrl!) : null;
  const resolver = new ApiFormatResolver(options.apiFormat ?? 'auto', upstreamUrl ?? undefined, upstreamMode === 'exact', upstreamMode !== 'none');
  const pathProtocol = upstreamMode === 'exact' ? detectProtocolFromPath(upstreamUrl!.pathname) : null;
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
  let server: http.Server;
  const dynamicUpstreamAllowed = () => options.allowRemoteDynamicUpstream === true || isLoopbackListener(server);
  const admin = createAdminHandler({
    store,
    analyzer,
    plugins,
    apiFormat: () => ({ ...resolver.resolution }),
    dynamicUpstreamAllowed,
    proxyUrlPath: (value) => new URL(buildDynamicProxyBaseUrl(value)).pathname,
  });

  server = http.createServer((request, response) => {
    if (serveRootBrandAsset(request, response)) return;
    const incomingUrl = new URL(request.url ?? '/', 'http://prompt-prism.local');
    let dynamicRoute: ReturnType<typeof parseDynamicUpstreamRoute> = null;
    if (incomingUrl.pathname.startsWith(DYNAMIC_UPSTREAM_PREFIX)) {
      if (!dynamicUpstreamAllowed()) return json(response, 403, { error: 'Dynamic upstreams are disabled for non-loopback listeners' });
      try { dynamicRoute = parseDynamicUpstreamRoute(request.url); }
      catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : 'Invalid encoded upstream value' }); }
    }
    if (!dynamicRoute && (request.url === '/_pp' || request.url?.startsWith('/_pp/'))) {
      admin(request, response).catch((error: unknown) => { if (!response.headersSent) response.writeHead(500); response.end(error instanceof Error ? error.message : String(error)); });
      return;
    }

    const requestPath = dynamicRoute?.requestPath ?? incomingUrl.pathname;
    if (request.method === 'GET' && requestPath.startsWith('/.well-known/')) {
      response.writeHead(404, { 'cache-control': 'no-store' });
      response.end();
      return;
    }
    if (!dynamicRoute && upstreamMode === 'none') {
      return json(response, 503, {
        error: 'No upstream configured',
        detail: 'Use a dynamic upstream URL under /_proxy/<encoded-upstream> or configure --upstream-base-url/--upstream-url',
      });
    }
    const { pathProtocol, headerProtocol, upstreamHint: requestUpstreamHint, targetUrl } = resolveProxyTarget({
      requestUrl: request.url,
      headers: request.headers,
      dynamicRoute,
      upstreamMode,
      upstreamUrl,
      resolver,
    });
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
        const capture = buildCapture({
          request,
          targetUrl,
          requestBody,
          responseBody,
          responseStatus: upstreamResponse.statusCode ?? null,
          responseHeaders: upstreamResponse.headers,
          responseContentType: upstreamResponse.headers['content-type'],
          timing: { startedAt, completedAt, startedMs, headersMs, firstByteMs, completedMs },
          resolver,
          upstreamHint: requestUpstreamHint,
          pathProtocol,
          headerProtocol,
        });
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
  const requestedPort = options.port ?? 1028;
  await new Promise<void>((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(requestedPort, options.host ?? '127.0.0.1', resolve);
  });
  const address = instance.server.address();
  const port = address && typeof address === 'object' ? address.port : requestedPort;
  const dashboard = `http://127.0.0.1:${port}/_pp/`;
  const format = instance.apiFormat.mode === 'auto' ? 'Auto · per capture' : instance.apiFormat.resolved;
  const upstream = instance.upstreamMode === 'none'
    ? 'Dynamic only'
    : `${instance.upstreamMode === 'base' ? 'Base' : 'URL '} ${instance.upstreamUrl!.href}`;
  console.log(`\n  Prompt Prism is running\n\n  Proxy          http://127.0.0.1:${port}\n  Dashboard      ${dashboard}\n  Upstream       ${upstream}\n  API format     ${format}\n\n  Point your model client base URL at the Proxy address.\n  Press Ctrl+C to stop.\n`);
  if (options.open !== false) openBrowser(dashboard);
  return { ...instance, port, dashboard };
}
