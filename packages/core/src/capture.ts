import crypto from 'node:crypto';
import type http from 'node:http';
import { detectProtocolFromBody, detectProtocolFromResponse, type ApiFormatResolver, type DetectedProtocol } from './adapter/detection.js';
import { getProviderAdapter } from './adapter/registry.js';
import type { Capture, RawHeaders } from './types.js';

const SENSITIVE = /^(authorization|proxy-authorization|x-api-key|api-key|cookie|set-cookie)$/i;
const TRACE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export interface CaptureTimingInput {
  startedAt: string;
  completedAt: string;
  startedMs: number;
  headersMs: number;
  firstByteMs: number | null;
  completedMs: number;
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

function traceParentIdentity(headers: http.IncomingHttpHeaders): string | undefined {
  const value = headers['x-prompt-prism-parent-capture-id'];
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'string' && TRACE_ID.test(candidate) ? candidate : undefined;
}

function shallowModel(body: Buffer): string | null {
  try {
    const value = JSON.parse(body.toString('utf8')) as { model?: unknown };
    return typeof value?.model === 'string' ? value.model : null;
  } catch { return null; }
}

export function buildCapture({
  request,
  targetUrl,
  requestBody,
  responseBody,
  responseStatus,
  responseHeaders,
  responseContentType,
  timing,
  resolver,
  upstreamHint,
  pathProtocol,
  headerProtocol,
  id = crypto.randomUUID(),
}: {
  request: Pick<http.IncomingMessage, 'method' | 'url' | 'headers'>;
  targetUrl: URL;
  requestBody: Buffer;
  responseBody: Buffer;
  responseStatus: number | null;
  responseHeaders: http.IncomingHttpHeaders;
  responseContentType?: string | string[];
  timing: CaptureTimingInput;
  resolver: ApiFormatResolver;
  upstreamHint: DetectedProtocol | null;
  pathProtocol: DetectedProtocol | null;
  headerProtocol: DetectedProtocol | null;
  id?: string;
}): Capture {
  const captureProtocol = resolver.resolveWithUpstreamHint(
    upstreamHint,
    pathProtocol,
    headerProtocol,
    detectProtocolFromBody(requestBody),
    detectProtocolFromResponse(responseBody),
  );
  const adapter = captureProtocol ? getProviderAdapter(captureProtocol) : null;
  let parsedRequest = null;
  let parsedResponse = null;
  if (adapter) {
    try {
      parsedRequest = adapter.parseRequest(requestBody);
      parsedResponse = adapter.parseResponse(responseBody, Array.isArray(responseContentType) ? responseContentType[0] : responseContentType);
    } catch { /* Preserve a Raw-only capture when provider extensions cannot be normalized. */ }
  }
  const traceId = traceIdentity(request.headers);
  const traceParentCaptureId = traceParentIdentity(request.headers);
  return {
    id,
    timestamp: timing.completedAt,
    token_hash: tokenIdentity(request.headers),
    model: parsedRequest?.model ?? shallowModel(requestBody),
    messages: parsedRequest?.messages ?? [],
    adapter_id: adapter?.id ?? 'unresolved',
    ...(parsedRequest ? { prompt_input: parsedRequest.input } : {}),
    usage: parsedResponse?.usage ?? {},
    ...(parsedResponse?.output ? { model_output: parsedResponse.output } : {}),
    ...(traceId ? { trace_id: traceId } : {}),
    ...(traceParentCaptureId ? { trace_parent_capture_id: traceParentCaptureId } : {}),
    upstream_host: targetUrl.host,
    timing: {
      started_at: timing.startedAt,
      completed_at: timing.completedAt,
      duration_ms: timing.completedMs - timing.startedMs,
      time_to_headers_ms: timing.headersMs - timing.startedMs,
      time_to_first_byte_ms: timing.firstByteMs === null ? null : timing.firstByteMs - timing.startedMs,
    },
    request: { method: request.method ?? 'GET', url: request.url ?? '/', target_url: targetUrl.href, headers: redactedHeaders(request.headers), body: requestBody.toString('utf8') },
    response: { status: responseStatus, headers: redactedHeaders(responseHeaders), body: responseBody.toString('utf8') },
  };
}
