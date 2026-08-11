import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DetailPane } from './DetailPane';
import type { CaptureSummary } from '../types';

const capture = (id: string): CaptureSummary => ({
  id,
  timestamp: '2026-08-09T06:00:00.000Z',
  token_hash: 'token',
  model: 'test-model',
  file_ref: `${id}.json`,
});

const analysis = (id: string) => ({
  id,
  timestamp: '2026-08-09T06:00:00.000Z',
  matched_parent_id: null,
  matched_message_count: 0,
  divergence_point: 0,
  diff: [{ type: 'insert', value: `{"id":"${id}"}` }],
  estimated_cacheable_tokens: 0,
  actual_cache_read_tokens: 0,
  estimated_cache_miss: 0,
  cache_hit_below_expected: false,
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('DetailPane plugin host', () => {
  it('supports keyboard tab selection and only loads the active plugin', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/trace/')) return new Response(JSON.stringify({ id: 'trace', source: 'explicit', selected_capture_id: 'one', truncated: false, calls: [] }), { status: 200 });
      if (url.includes('/input-diff/')) return new Response(JSON.stringify(analysis('one')), { status: 200 });
      if (url.includes('/output/')) return new Response(JSON.stringify({ output: null }), { status: 200 });
      return new Response(JSON.stringify({ request: null, response: null }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DetailPane capture={capture('one')} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/_pp/api/trace/one', expect.anything()));
    expect(fetchMock).not.toHaveBeenCalledWith('/_pp/api/raw/one', expect.anything());

    const traceTab = screen.getByRole('tab', { name: 'Trace' });
    traceTab.focus();
    await userEvent.keyboard('{ArrowRight}{Enter}');
    expect(screen.getByRole('tab', { name: 'Input Diff' })).toHaveAttribute('data-active');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/_pp/api/input-diff/one', expect.anything()));
    expect(fetchMock).not.toHaveBeenCalledWith('/_pp/api/raw/one', expect.anything());
  });

  it('syncs an externally selected tab and loads the new panel', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/input-diff/')) return new Response(JSON.stringify(analysis('one')), { status: 200 });
      if (url.includes('/trace/')) return new Response(JSON.stringify({ id: 'trace', source: 'explicit', selected_capture_id: 'one', truncated: false, calls: [] }), { status: 200 });
      return new Response(JSON.stringify({ output: null }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const view = render(<DetailPane capture={capture('one')} initialTab="input-diff" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/_pp/api/input-diff/one', expect.anything()));
    view.rerender(<DetailPane capture={capture('one')} initialTab="trace" />);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Trace' })).toHaveAttribute('data-active'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/_pp/api/trace/one', expect.anything()));
    expect(screen.getByText('No trace calls are available.')).toBeVisible();
  });

  it('retries a failed load and caches the successful result', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue(new Response(JSON.stringify(analysis('one')), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<DetailPane capture={capture('one')} initialTab="input-diff" />);
    expect(await screen.findByText('temporary failure')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/"one"/)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts an in-flight plugin load when the capture changes', async () => {
    let firstSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/one')) {
        firstSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      }
      return Promise.resolve(new Response(JSON.stringify(analysis('two')), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<DetailPane capture={capture('one')} initialTab="input-diff" />);
    await waitFor(() => expect(firstSignal).toBeDefined());
    rerender(<DetailPane capture={capture('two')} />);
    await waitFor(() => expect(firstSignal?.aborted).toBe(true));
    expect(await screen.findByText(/"two"/)).toBeVisible();
  });

  it('polls only the active polling plugin without overlapping requests and aborts on cleanup', async () => {
    vi.useFakeTimers();
    let traceCalls = 0;
    let pollingSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/input-diff/')) return Promise.resolve(new Response(JSON.stringify(analysis('one')), { status: 200 }));
      if (url.includes('/trace/')) {
        traceCalls += 1;
        if (traceCalls === 1) return Promise.resolve(new Response(JSON.stringify({ id: 'trace', source: 'explicit', selected_capture_id: 'one', truncated: false, calls: [] }), { status: 200 }));
        pollingSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const view = render(<DetailPane capture={capture('one')} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(screen.getByRole('tab', { name: 'Trace' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(traceCalls).toBe(1);
    await act(async () => { vi.advanceTimersByTime(3_000); await Promise.resolve(); });
    expect(traceCalls).toBe(2);
    await act(async () => { vi.advanceTimersByTime(6_000); await Promise.resolve(); });
    expect(traceCalls).toBe(2);
    view.unmount();
    expect(pollingSignal?.aborted).toBe(true);
  });
});
