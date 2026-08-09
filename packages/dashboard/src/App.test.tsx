import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InputDiffAnalysis, RawCapture } from '@prompt-prism/plugins/dashboard';
import App from './App';
import type { CaptureSummary } from './types';

const captures: CaptureSummary[] = [
  {
    id: 'newest-capture', timestamp: '2026-08-09T07:00:00.000Z', token_hash: 'aaaaaaaaaaaaaaaa',
    model: 'newest-model', file_ref: 'newest.json', usage: { input_tokens: 100, cache_read_input_tokens: 80 },
    response_status: 200, upstream_host: 'api.stepfun.com',
    analysis: { id: 'newest-capture', timestamp: '2026-08-09T07:00:00.000Z', matched_parent_id: 'older-capture', matched_message_count: 1, divergence_point: 40, estimated_cacheable_tokens: 10, actual_cache_read_tokens: 8, estimated_cache_miss: 2, cache_hit_below_expected: false },
  },
  {
    id: 'older-capture', timestamp: '2026-08-09T06:00:00.000Z', token_hash: 'bbbbbbbbbbbbbbbb',
    model: 'older-model', file_ref: 'older.json', usage: { input_tokens: 50, cache_read_input_tokens: 0 },
    response_status: 401, upstream_host: 'provider.example.com:8443',
    analysis: { id: 'older-capture', timestamp: '2026-08-09T06:00:00.000Z', matched_parent_id: null, matched_message_count: 0, divergence_point: 0, estimated_cacheable_tokens: 0, actual_cache_read_tokens: 0, estimated_cache_miss: 0, cache_hit_below_expected: false },
  },
];

const details: Record<string, InputDiffAnalysis> = {
  'newest-capture': { ...(captures[0].analysis as Omit<InputDiffAnalysis, 'diff'>), diff: [{ type: 'equal', value: 'newest prompt' }] },
  'older-capture': { ...(captures[1].analysis as Omit<InputDiffAnalysis, 'diff'>), diff: [{ type: 'insert', value: 'older prompt' }] },
};

const rawDetails: Record<string, RawCapture> = {
  'newest-capture': {
    request: { method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json', 'x-api-key': '[REDACTED]' }, body: '{"model":"newest-model","messages":[{"role":"user","content":"hello"}]}' },
    response: { status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'event: message_stop\ndata: {}\n\n' },
  },
  'older-capture': {
    request: { method: 'POST', url: '/v1/messages', headers: {}, body: '{"model":"older-model"}' },
    response: { status: 401, headers: {}, body: '{"error":"unauthorized"}' },
  },
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
      const value = url.includes('/raw/') ? rawDetails[id] : details[id];
      return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<App />);
    expect(container.querySelector('.logo-mark')).toHaveAttribute('src', '/_pp/brand/logo-mark.png');
    expect(container.querySelector('.app-header .logo-mark')).toBeVisible();
    expect(screen.getByText('Prompt Prism')).toBeVisible();
    expect(screen.getByText('Prompt & response inspector')).toBeVisible();
    expect(screen.queryByText('Prompt cache debugger')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /newest-model/i })).toHaveAttribute('data-selected');
    expect(screen.getAllByText('HTTP 200')[0]).toHaveClass('status-label--good');
    expect(screen.getAllByText('api.stepfun.com')[0]).toBeVisible();
    expect(await screen.findByText('newest prompt')).toBeVisible();
    expect(screen.queryByText(/cache read/i)).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('capture')).toBe('newest-capture');
    expect(fetchMock).not.toHaveBeenCalledWith('/_pp/api/raw/newest-capture', expect.anything());

    await userEvent.click(screen.getByRole('tab', { name: 'Raw' }));
    expect(screen.getByRole('tab', { name: 'Raw' })).toHaveAttribute('data-active');
    expect(screen.getByRole('tab', { name: 'Input Diff' })).not.toHaveAttribute('data-active');
    expect(await screen.findByRole('region', { name: 'Request' })).toHaveTextContent('newest-model');
    expect(screen.getByRole('region', { name: 'Response' })).toHaveTextContent('message_stop');
    expect(fetchMock).toHaveBeenCalledWith('/_pp/api/raw/newest-capture', expect.anything());

    await userEvent.click(screen.getByRole('tab', { name: 'Input Diff' }));
    expect(screen.getByRole('tab', { name: 'Input Diff' })).toHaveAttribute('data-active');
    await userEvent.click(screen.getByRole('tab', { name: 'Raw' }));
    expect(fetchMock.mock.calls.filter(([url]) => url === '/_pp/api/raw/newest-capture')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: /older-model/i }));
    expect(await screen.findByRole('button', { name: /older-model/i })).toHaveAttribute('data-selected');
    expect(await screen.findByText(/unauthorized/)).toBeVisible();
    expect(new URLSearchParams(window.location.search).get('capture')).toBe('older-capture');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/_pp/api/raw/older-capture', expect.anything()));
    expect(fetchMock).not.toHaveBeenCalledWith('/_pp/api/input-diff/older-capture', expect.anything());

    await userEvent.click(screen.getByRole('tab', { name: 'Input Diff' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/_pp/api/input-diff/older-capture', expect.anything()));
  });
});
