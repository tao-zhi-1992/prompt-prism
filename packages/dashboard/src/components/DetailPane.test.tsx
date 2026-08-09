import { render, screen, waitFor } from '@testing-library/react';
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

afterEach(() => vi.unstubAllGlobals());

describe('DetailPane plugin host', () => {
  it('supports keyboard tab selection and only loads the active plugin', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/input-diff/')) return new Response(JSON.stringify(analysis('one')), { status: 200 });
      return new Response(JSON.stringify({ request: null, response: null }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DetailPane capture={capture('one')} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/_pp/api/input-diff/one', expect.anything()));
    expect(fetchMock).not.toHaveBeenCalledWith('/_pp/api/raw/one', expect.anything());

    const diffTab = screen.getByRole('tab', { name: 'Input Diff' });
    diffTab.focus();
    await userEvent.keyboard('{ArrowRight}{Enter}');
    expect(screen.getByRole('tab', { name: 'Raw' })).toHaveAttribute('data-active');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/_pp/api/raw/one', expect.anything()));
  });

  it('retries a failed load and caches the successful result', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue(new Response(JSON.stringify(analysis('one')), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<DetailPane capture={capture('one')} />);
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

    const { rerender } = render(<DetailPane capture={capture('one')} />);
    await waitFor(() => expect(firstSignal).toBeDefined());
    rerender(<DetailPane capture={capture('two')} />);
    await waitFor(() => expect(firstSignal?.aborted).toBe(true));
    expect(await screen.findByText(/"two"/)).toBeVisible();
  });
});
