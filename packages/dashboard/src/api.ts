import type { CaptureSummary } from './types';

async function readJson<T>(response: Response): Promise<T> {
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error || `Request failed with ${response.status}`);
  return value as T;
}

export async function getCaptures(signal?: AbortSignal): Promise<CaptureSummary[]> {
  return readJson(await fetch('/_pp/api/logs', { signal, cache: 'no-store' }));
}
