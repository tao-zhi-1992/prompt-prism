import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureChange, CapturePage } from '../api';
import type { CaptureSummary } from '../types';

const api = vi.hoisted(() => ({
  clearCaptures: vi.fn(),
  getCaptureChanges: vi.fn(),
  getCapturePage: vi.fn(),
}));
vi.mock('../api', () => api);

import { useCaptureFeed } from './useCaptureFeed';

const capture = (id: string, timestamp = '2026-08-14T00:00:00.000Z'): CaptureSummary => ({
  id, timestamp, token_hash: id, model: id, file_ref: `${id}.json`,
});

const page = (items: CaptureSummary[], overrides: Partial<CapturePage> = {}): CapturePage => ({
  items, total: items.length, oldest_cursor: null, newest_cursor: items.length ? 'newest' : null,
  has_older: false, has_newer: false, revision: 0, ...overrides,
});

class Source extends EventTarget {
  static instances: Source[] = [];
  readonly url: string;
  onerror: (() => void) | null = null;
  constructor(url: string) { super(); this.url = url; Source.instances.push(this); }
  close() {}
  emit(type: string, data: unknown): void { this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) })); }
}

const change = (revision: number, added: CaptureSummary[] = []): CaptureChange => ({ revision, added, updated: [], removed_ids: [], total: added.length });

beforeEach(() => {
  vi.clearAllMocks();
  Source.instances = [];
  vi.stubGlobal('EventSource', Source);
  api.getCaptureChanges.mockResolvedValue({ revision: 0, changes: [] });
  api.clearCaptures.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useCaptureFeed', () => {
  it('keeps the initial list on failure and retries successfully', async () => {
    api.getCapturePage.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page([capture('retry')]));
    const { result } = renderHook(() => useCaptureFeed());
    await waitFor(() => expect(result.current.state.listError).toBe('offline'));
    act(() => result.current.retryInitial());
    await waitFor(() => expect(result.current.state.captures.map(({ id }) => id)).toEqual(['retry']));
    expect(result.current.state.listError).toBeNull();
  });

  it('loads older pages, prevents duplicate loads, and preserves data on error', async () => {
    api.getCapturePage.mockResolvedValueOnce(page([capture('new')], { has_older: true, oldest_cursor: 'oldest' }))
      .mockResolvedValueOnce(page([capture('old')], { has_older: true, oldest_cursor: 'older' }))
      .mockRejectedValueOnce(new Error('history unavailable'));
    const { result } = renderHook(() => useCaptureFeed());
    await waitFor(() => expect(result.current.state.listLoading).toBe(false));
    await act(async () => { await result.current.loadOlder(); });
    expect(result.current.state.captures.map(({ id }) => id)).toEqual(['old', 'new']);
    await act(async () => { await result.current.loadOlder(); });
    expect(result.current.state.olderError).toBe('history unavailable');
    expect(api.getCapturePage).toHaveBeenCalledTimes(3);
  });

  it('applies SSE changes, ignores stale revisions, and reloads on reset', async () => {
    const incoming = capture('incoming', '2026-08-14T00:01:00.000Z');
    api.getCapturePage.mockResolvedValueOnce(page([capture('initial')], { revision: 2 }))
      .mockResolvedValueOnce(page([incoming], { revision: 3 }));
    const { result } = renderHook(() => useCaptureFeed());
    await waitFor(() => expect(result.current.state.captures).toHaveLength(1));
    Source.instances[0]!.emit('change', change(1, [capture('stale')]));
    expect(result.current.state.captures.map(({ id }) => id)).toEqual(['initial']);
    Source.instances[0]!.emit('change', change(3, [incoming]));
    await waitFor(() => expect(result.current.state.captures.map(({ id }) => id)).toEqual(['incoming', 'initial']));
    Source.instances[0]!.emit('reset', {});
    await waitFor(() => expect(api.getCapturePage).toHaveBeenCalledTimes(2));
  });

  it('falls back to changes polling after EventSource failures and surfaces clear errors', async () => {
    vi.stubGlobal('EventSource', undefined);
    api.getCapturePage.mockResolvedValueOnce(page([capture('initial')]));
    api.getCaptureChanges.mockResolvedValueOnce({ revision: 1, changes: [change(1, [capture('polled')])] });
    const { result } = renderHook(() => useCaptureFeed());
    await waitFor(() => expect(result.current.state.captures.map(({ id }) => id)).toContain('polled'), { timeout: 4500, interval: 100 });

    api.clearCaptures.mockRejectedValueOnce(new Error('clear failed'));
    await expect(result.current.clear()).rejects.toThrow('clear failed');
    await waitFor(() => expect(result.current.state.listError).toBe('clear failed'));
  });
});
