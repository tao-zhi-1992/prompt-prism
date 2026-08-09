import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { Analysis, CaptureSummary } from './types';

const captures: CaptureSummary[] = [
  {
    id: 'newest-capture', timestamp: '2026-08-09T07:00:00.000Z', token_hash: 'aaaaaaaaaaaaaaaa',
    model: 'newest-model', file_ref: 'newest.json', usage: { input_tokens: 100, cache_read_input_tokens: 80 },
    analysis: { id: 'newest-capture', timestamp: '2026-08-09T07:00:00.000Z', matched_parent_id: 'older-capture', matched_message_count: 1, divergence_point: 40, estimated_cacheable_tokens: 10, actual_cache_read_tokens: 8, estimated_cache_miss: 2, cache_hit_below_expected: false },
  },
  {
    id: 'older-capture', timestamp: '2026-08-09T06:00:00.000Z', token_hash: 'bbbbbbbbbbbbbbbb',
    model: 'older-model', file_ref: 'older.json', usage: { input_tokens: 50, cache_read_input_tokens: 0 },
    analysis: { id: 'older-capture', timestamp: '2026-08-09T06:00:00.000Z', matched_parent_id: null, matched_message_count: 0, divergence_point: 0, estimated_cacheable_tokens: 0, actual_cache_read_tokens: 0, estimated_cache_miss: 0, cache_hit_below_expected: false },
  },
];

const details: Record<string, Analysis> = {
  'newest-capture': { ...captures[0].analysis!, diff: [{ type: 'equal', value: 'newest prompt' }] },
  'older-capture': { ...captures[1].analysis!, diff: [{ type: 'insert', value: 'older prompt' }] },
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/_pp/');
});

describe('App', () => {
  it('selects the newest capture, loads its diff, and keeps click selection in the URL', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/_pp/api/logs') return new Response(JSON.stringify(captures), { status: 200, headers: { 'content-type': 'application/json' } });
      const id = decodeURIComponent(url.split('/').at(-1)!);
      return new Response(JSON.stringify(details[id]), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<App />);
    expect(container.querySelector('.logo-mark')).toHaveAttribute('src', '/_pp/brand/logo-mark.png');
    expect(await screen.findByRole('heading', { name: 'newest-model' })).toBeVisible();
    expect(await screen.findByText('newest prompt')).toBeVisible();
    expect(new URLSearchParams(window.location.search).get('capture')).toBe('newest-capture');

    await userEvent.click(screen.getByRole('button', { name: /older-model/i }));
    expect(await screen.findByRole('heading', { name: 'older-model' })).toBeVisible();
    expect(await screen.findByText('older prompt')).toBeVisible();
    expect(new URLSearchParams(window.location.search).get('capture')).toBe('older-capture');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/_pp/api/diff/older-capture', expect.anything()));
  });
});
