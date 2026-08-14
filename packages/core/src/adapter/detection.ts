import type http from 'node:http';
import type { ApiFormatOption, ApiFormatResolution, ProviderProtocol } from '../types.js';
import { getProviderAdapter, normalizeProviderProtocol, providerAdapters } from './registry.js';

export type DetectedProtocol = ProviderProtocol;

function detected(test: (adapter: ReturnType<typeof providerAdapters>[number]) => boolean): DetectedProtocol | null {
  return providerAdapters().find(test)?.id as DetectedProtocol | undefined ?? null;
}

export function detectProtocolFromPath(pathname: string): DetectedProtocol | null { return detected((adapter) => adapter.detection.detectPath(pathname)); }
export function detectProtocolFromBaseUrl(url: URL): DetectedProtocol | null { return detected((adapter) => adapter.detection.detectBaseUrl(url)); }
export function detectProtocolFromHeaders(headers: http.IncomingHttpHeaders): DetectedProtocol | null { return detected((adapter) => adapter.detection.detectHeaders(headers)); }
export function detectProtocolFromBody(body: Buffer | string): DetectedProtocol | null { return detected((adapter) => adapter.detection.detectRequest(body)); }
export function detectProtocolFromResponse(body: Buffer | string): DetectedProtocol | null { return detected((adapter) => adapter.detection.detectResponse(body)); }
export function endpointPath(protocol: DetectedProtocol): string { return getProviderAdapter(protocol).detection.endpointPath; }

export class ApiFormatResolver {
  readonly resolution: ApiFormatResolution;
  readonly upstreamHint: DetectedProtocol | null;

  constructor(option: ApiFormatOption = 'auto', upstreamUrl?: URL, exact = false, useUpstreamHint = true) {
    if (option !== 'auto') {
      const canonical = normalizeProviderProtocol(option) as ProviderProtocol;
      getProviderAdapter(canonical);
      this.resolution = { mode: 'explicit', configured: canonical, resolved: canonical, source: 'explicit' };
      this.upstreamHint = null;
      return;
    }
    this.resolution = { mode: 'auto', configured: 'auto', resolved: null, source: null };
    this.upstreamHint = upstreamUrl && useUpstreamHint ? (exact ? detectProtocolFromPath(upstreamUrl.pathname) : detectProtocolFromBaseUrl(upstreamUrl)) : null;
  }
  resolve(...evidence: Array<DetectedProtocol | null>): DetectedProtocol | null { return this.resolveWithUpstreamHint(this.upstreamHint, ...evidence); }
  resolveWithUpstreamHint(upstreamHint: DetectedProtocol | null, ...evidence: Array<DetectedProtocol | null>): DetectedProtocol | null {
    return this.resolution.mode === 'explicit' ? this.resolution.resolved : evidence.find((protocol): protocol is DetectedProtocol => protocol !== null) ?? upstreamHint;
  }
}
