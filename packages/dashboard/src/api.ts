import type { CaptureSummary } from './types';

export interface CapturePage {
  items: CaptureSummary[];
  total: number;
  oldest_cursor: string | null;
  newest_cursor: string | null;
  has_older: boolean;
  has_newer: boolean;
}

export interface NewCaptureBatch {
  items: CaptureSummary[];
  total: number;
  newestCursor: string;
}

async function readJson<T>(response: Response): Promise<T> {
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error || `Request failed with ${response.status}`);
  return value as T;
}

export async function getCapturePage({ before, after, limit = 100, signal }: { before?: string; after?: string; limit?: number; signal?: AbortSignal } = {}): Promise<CapturePage> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set('before', before);
  if (after) params.set('after', after);
  return readJson(await fetch(`/_pp/api/logs?${params}`, { signal, cache: 'no-store' }));
}

export async function getCaptureSummary(id: string, signal?: AbortSignal): Promise<CaptureSummary> {
  return readJson(await fetch(`/_pp/api/logs/${encodeURIComponent(id)}`, { signal, cache: 'no-store' }));
}

export async function getTraceFirstCaptureId(captureId: string, signal?: AbortSignal): Promise<string> {
  const trace = await readJson<{ calls?: Array<{ capture_id?: unknown }> }>(await fetch(`/_pp/api/trace/${encodeURIComponent(captureId)}`, { signal, cache: 'no-store' }));
  const firstCaptureId = trace.calls?.[0]?.capture_id;
  return typeof firstCaptureId === 'string' && firstCaptureId ? firstCaptureId : captureId;
}

export async function getNewCaptureBatch(after: string, signal?: AbortSignal): Promise<NewCaptureBatch> {
  const items: CaptureSummary[] = [];
  let cursor = after;
  let total = 0;
  let hasNewer = true;
  while (hasNewer && !signal?.aborted) {
    const page = await getCapturePage({ after: cursor, signal });
    items.push(...page.items);
    total = page.total;
    hasNewer = page.has_newer;
    if (!page.newest_cursor || page.newest_cursor === cursor) break;
    cursor = page.newest_cursor;
  }
  return { items, total, newestCursor: cursor };
}

export async function clearCaptures(): Promise<void> {
  await readJson(await fetch('/_pp/api/logs', { method: 'DELETE' }));
}

export async function generateProxyUrl(upstreamBaseUrl: string): Promise<string> {
  const result = await readJson<{ path: string }>(await fetch('/_pp/api/proxy-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ upstream_base_url: upstreamBaseUrl }),
  }));
  return `${window.location.origin}${result.path}`;
}
