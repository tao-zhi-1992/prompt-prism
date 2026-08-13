import type http from 'node:http';
import { ApiFormatResolver, detectProtocolFromHeaders, detectProtocolFromPath, endpointPath, type DetectedProtocol } from './adapter/detection.js';
import type { DynamicUpstreamRoute } from './upstream.js';

export type UpstreamMode = 'base' | 'exact' | 'none';

export interface ProxyTargetResolution {
  requestPath: string;
  pathProtocol: DetectedProtocol | null;
  headerProtocol: DetectedProtocol | null;
  upstreamHint: DetectedProtocol | null;
  targetUrl: URL;
}

function joinedTarget(baseUrl: URL, requestUrl: string | undefined, protocol: DetectedProtocol | null): URL {
  const incoming = new URL(requestUrl ?? '/', 'http://prompt-prism.local');
  const target = new URL(baseUrl);
  const suffix = detectProtocolFromPath(incoming.pathname) ? incoming.pathname : protocol ? endpointPath(protocol) : incoming.pathname;
  target.pathname = `${baseUrl.pathname.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`;
  target.search = incoming.search;
  return target;
}

function directTarget(baseUrl: URL, requestUrl: string): URL {
  const target = new URL(baseUrl);
  target.search = new URL(requestUrl, 'http://prompt-prism.local').search;
  return target;
}

function joinedDynamicTarget(baseUrl: URL, requestUrl: string): URL {
  const incoming = new URL(requestUrl, 'http://prompt-prism.local');
  const target = new URL(baseUrl);
  target.pathname = `${baseUrl.pathname.replace(/\/+$/, '')}/${incoming.pathname.replace(/^\/+/, '')}`;
  target.search = incoming.search;
  return target;
}

export function resolveProxyTarget({
  requestUrl,
  headers,
  dynamicRoute,
  upstreamMode,
  upstreamUrl,
  resolver,
}: {
  requestUrl: string | undefined;
  headers: http.IncomingHttpHeaders;
  dynamicRoute: DynamicUpstreamRoute | null;
  upstreamMode: UpstreamMode;
  upstreamUrl: URL | null;
  resolver: ApiFormatResolver;
}): ProxyTargetResolution {
  const incomingUrl = new URL(requestUrl ?? '/', 'http://prompt-prism.local');
  const requestPath = dynamicRoute?.requestPath ?? incomingUrl.pathname;
  const pathProtocol = detectProtocolFromPath(requestPath);
  const headerProtocol = detectProtocolFromHeaders(headers);
  const upstreamHint = dynamicRoute
    ? new ApiFormatResolver('auto', dynamicRoute.baseUrl).upstreamHint
    : resolver.upstreamHint;
  const routingProtocol = resolver.resolveWithUpstreamHint(upstreamHint, pathProtocol, headerProtocol);
  if (!dynamicRoute && (upstreamMode === 'none' || !upstreamUrl)) throw new Error('No upstream target available');
  const targetUrl = dynamicRoute
    ? dynamicRoute.requestSuffix === null
      ? directTarget(dynamicRoute.baseUrl, dynamicRoute.requestUrl)
      : joinedDynamicTarget(dynamicRoute.baseUrl, dynamicRoute.requestUrl)
    : upstreamMode === 'exact'
      ? upstreamUrl!
      : joinedTarget(upstreamUrl!, requestUrl, routingProtocol);
  return { requestPath, pathProtocol, headerProtocol, upstreamHint, targetUrl };
}

export function isLoopbackListener(server: http.Server): boolean {
  const address = server.address();
  if (!address || typeof address === 'string') return false;
  const value = address.address.toLowerCase();
  return value === '::1' || /^127(?:\.\d{1,3}){3}$/.test(value) || /^::ffff:127(?:\.\d{1,3}){3}$/.test(value);
}
