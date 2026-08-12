import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InputDiffAnalysis, OutputCapture, RawCapture } from '@prompt-prism/plugins/dashboard';
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

function capturePage(items = captures, overrides: Record<string, unknown> = {}) {
  return { items, total: items.length, oldest_cursor: items.length ? 'oldest-cursor' : null, newest_cursor: items.length ? 'newest-cursor' : null, has_older: false, has_newer: false, ...overrides };
}

function isLogsPage(url: string) {
  return url.startsWith('/_pp/api/logs?');
}

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

const outputDetails: Record<string, OutputCapture> = {
  'newest-capture': { output: {
    adapter_id: 'anthropic', id: 'message-new', model: 'newest-model', role: 'assistant', stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 12 }, content: [{ type: 'text', text: 'newest output' }],
  } },
  'older-capture': { output: {
    adapter_id: 'anthropic', id: null, model: null, role: null, stop_reason: null, usage: {}, content: [],
    error: { type: 'authentication_error', message: 'unauthorized' },
  } },
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.removeItem('prompt-prism-locale');
  document.documentElement.lang = '';
  window.history.replaceState(null, '', '/_pp/');
});

describe('App', () => {
  it('loads only the capture list when no capture is present in the URL', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (isLogsPage(String(input))) return new Response(JSON.stringify(capturePage()), { status: 200 });
      throw new Error(`unexpected detail request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByRole('button', { name: /newest-model/i });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(window.location.search).get('capture')).toBeNull();
  });

  it('shows the server total and appends an older page independently', async () => {
    const older = { ...captures[1], id: 'historical-capture', model: 'historical-model', timestamp: '2026-08-08T06:00:00.000Z' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/_pp/api/logs?limit=100') return new Response(JSON.stringify(capturePage(captures.slice(0, 1), { total: 250, has_older: true, oldest_cursor: 'page-one' })));
      if (url === '/_pp/api/logs?limit=100&before=page-one') return new Response(JSON.stringify(capturePage([older], { total: 250, newest_cursor: 'old-page-newest' })));
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByText('250')).toBeVisible();
    expect(await screen.findByRole('button', { name: /historical-model/i })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/_pp/api/logs?limit=100&before=page-one', expect.anything());
  });

  it('loads a deep-linked capture outside the current page by id', async () => {
    const deep = { ...captures[1], id: 'deep-capture', model: 'deep-model' };
    window.history.replaceState(null, '', '/_pp/?capture=deep-capture&tab=input-diff');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (isLogsPage(url)) return new Response(JSON.stringify(capturePage(captures.slice(0, 1), { total: 200, has_older: true })));
      if (url === '/_pp/api/logs/deep-capture') return new Response(JSON.stringify(deep));
      if (url === '/_pp/api/input-diff/deep-capture') return new Response(JSON.stringify({ ...details['older-capture'], id: 'deep-capture', diff: [{ type: 'equal', value: 'deep prompt' }] }));
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByText('deep prompt')).toBeVisible();
    expect(new URLSearchParams(window.location.search).get('capture')).toBe('deep-capture');
    expect(fetchMock).toHaveBeenCalledWith('/_pp/api/logs/deep-capture', expect.anything());
  });

  it('stages polled captures while browsing history and merges them on demand', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const incoming = { ...captures[0], id: 'polled-capture', model: 'polled-model', timestamp: '2026-08-10T07:00:00.000Z' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/_pp/api/logs?limit=100') return new Response(JSON.stringify(capturePage(captures.slice(0, 1))));
      if (url === '/_pp/api/logs?limit=100&after=newest-cursor') return new Response(JSON.stringify(capturePage([incoming], { total: 2, oldest_cursor: 'polled-cursor', newest_cursor: 'polled-cursor' })));
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<App />);
    await screen.findByRole('button', { name: /newest-model/i });
    const viewport = container.querySelector<HTMLElement>('.request-scroll .scroll-viewport')!;
    viewport.scrollTop = 100;
    fireEvent.scroll(viewport);

    await vi.advanceTimersByTimeAsync(3000);
    expect(await screen.findByRole('button', { name: '1 new requests' })).toBeVisible();
    expect(screen.queryByText('polled-model')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '1 new requests' }));
    expect(await screen.findByText('polled-model')).toBeVisible();
    expect(screen.getByText('2')).toBeVisible();
    expect(viewport.scrollTop).toBe(0);
  });

  it('continues polling when the initial capture page is empty', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(capturePage([]))))
      .mockResolvedValueOnce(new Response(JSON.stringify(capturePage(captures.slice(0, 1)))));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    expect(await screen.findByText('No requests yet')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Proxy URL' })).toBeVisible();

    await vi.advanceTimersByTimeAsync(3000);

    expect(await screen.findByRole('button', { name: /newest-model/i })).toBeVisible();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/_pp/api/logs?limit=100',
      '/_pp/api/logs?limit=100',
    ]);
  });

  it('keeps loaded requests and recovers after a polling error', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(capturePage(captures.slice(0, 1)))))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'temporary failure' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(capturePage([], { total: 1 }))));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    expect(await screen.findByRole('button', { name: /newest-model/i })).toBeVisible();

    await vi.advanceTimersByTimeAsync(3000);
    expect(await screen.findByText('Refresh paused · temporary failure')).toBeVisible();
    expect(screen.getByText('newest-model')).toBeVisible();

    await vi.advanceTimersByTimeAsync(3000);
    await waitFor(() => expect(screen.queryByText(/Refresh paused/)).not.toBeInTheDocument());
    expect(screen.getByText('newest-model')).toBeVisible();
  });

  it('keeps the selected Input Diff tab when selecting a capture from the list', async () => {
    window.history.replaceState(null, '', '/_pp/?tab=input-diff');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (isLogsPage(url)) return new Response(JSON.stringify(capturePage()), { status: 200 });
      if (url.includes('/input-diff/')) {
        const id = decodeURIComponent(url.split('/').at(-1)!);
        return new Response(JSON.stringify(details[id]), { status: 200 });
      }
      throw new Error(`unexpected detail request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /older-model/i }));

    expect(new URLSearchParams(window.location.search).get('capture')).toBe('older-capture');
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('input-diff');
    expect(window.location.hash).toBe('');
    expect(await screen.findByText('older prompt')).toBeVisible();
  });

  it('navigates from an Input Diff parent link without reloading and preserves its target hash', async () => {
    window.history.replaceState(null, '', '/_pp/?capture=newest-capture&tab=input-diff');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (isLogsPage(url)) return new Response(JSON.stringify(capturePage()), { status: 200 });
      if (url.includes('/input-diff/')) {
        const id = decodeURIComponent(url.split('/').at(-1)!);
        return new Response(JSON.stringify(details[id]), { status: 200 });
      }
      throw new Error(`unexpected detail request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    const parentLink = await screen.findByRole('link', { name: 'Compared with older-ca' });
    await userEvent.click(parentLink);

    expect(new URLSearchParams(window.location.search).get('capture')).toBe('older-capture');
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('input-diff');
    expect(window.location.hash).toBe('#input-diff-section-messages');
    expect(await screen.findByRole('button', { name: /older-model/i })).toHaveAttribute('data-selected');
    expect(await screen.findByText('No related request')).toBeVisible();
  });

  it('selects the newest capture and keeps click selection in the URL', async () => {
    window.history.replaceState(null, '', '/_pp/?capture=newest-capture&tab=input-diff');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (isLogsPage(url)) return new Response(JSON.stringify(capturePage()), { status: 200, headers: { 'content-type': 'application/json' } });
      const id = decodeURIComponent(url.split('/').at(-1)!);
      const value = url.includes('/raw/') ? rawDetails[id] : url.includes('/output/') ? outputDetails[id] : details[id];
      return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<App />);
    expect(container.querySelector('.logo-mark')).toHaveAttribute('src', '/_pp/brand/logo-mark.png');
    expect(container.querySelector('.app-header .logo-mark')).toBeVisible();
    expect(screen.getByText('Prompt Prism')).toBeVisible();
    expect(screen.getByText(`v${__PROMPT_PRISM_VERSION__}`)).toBeVisible();
    expect(screen.queryByText('Prompt & response inspector')).not.toBeInTheDocument();
    expect(screen.queryByText('Prompt cache debugger')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /newest-model/i })).toHaveAttribute('data-selected');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Trace', 'Input Diff', 'Output', 'Tools', 'System Prompt', 'Raw']);
    expect(screen.getAllByText('HTTP 200')[0]).toHaveClass('status-label--good');
    expect(await screen.findByText('newest prompt')).toBeVisible();
    expect(screen.queryByText(/cache read/i)).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('capture')).toBe('newest-capture');
    expect(fetchMock).not.toHaveBeenCalledWith('/_pp/api/raw/newest-capture', expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith('/_pp/api/output/newest-capture', expect.anything());

    await userEvent.click(screen.getByRole('tab', { name: 'Output' }));
    expect(screen.getByRole('tab', { name: 'Output' })).toHaveAttribute('data-active');
    expect(await screen.findByText('newest output')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/_pp/api/output/newest-capture', expect.anything());

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
    expect(screen.getByRole('tab', { name: 'Raw' })).toHaveAttribute('data-active');

    await userEvent.click(screen.getByRole('tab', { name: 'Input Diff' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/_pp/api/input-diff/older-capture', expect.anything()));
  });

  it('switches and persists Chinese across the shell and built-in tabs', async () => {
    window.history.replaceState(null, '', '/_pp/?capture=newest-capture&tab=input-diff');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (isLogsPage(url)) return new Response(JSON.stringify(capturePage(captures.slice(0, 1))), { status: 200 });
      if (url.includes('/input-diff/')) return new Response(JSON.stringify(details['newest-capture']), { status: 200 });
      if (url.includes('/output/')) return new Response(JSON.stringify(outputDetails['newest-capture']), { status: 200 });
      if (url.includes('/trace/')) return new Response(JSON.stringify({ id: 'trace-1', source: 'explicit', selected_capture_id: 'newest-capture', truncated: false, calls: [] }), { status: 200 });
      return new Response(JSON.stringify(rawDetails['newest-capture']), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('button', { name: /newest-model/i });
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /中文/ }));

    expect(screen.getByText(`v${__PROMPT_PRISM_VERSION__}`)).toBeVisible();
    expect(screen.queryByText('提示词与响应检查器')).not.toBeInTheDocument();
    expect(screen.getByText('请求')).toBeVisible();
    expect(screen.getByRole('button', { name: '代理地址' })).toBeVisible();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['追踪', '输入差异', '输出', '工具', '系统提示词', '原始数据']);
    expect(window.localStorage.getItem('prompt-prism-locale')).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');

    await userEvent.click(screen.getByRole('tab', { name: '输出' }));
    expect(await screen.findByText('文本')).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: '原始数据' }));
    expect(await screen.findByRole('region', { name: '请求' })).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: '追踪' }));
    expect(await screen.findByText('调用数')).toBeVisible();
  });

  it('closes the clear confirmation when clicking outside', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (isLogsPage(url)) return new Response(JSON.stringify(capturePage(captures.slice(0, 1))), { status: 200 });
      return new Response(JSON.stringify(details['newest-capture']), { status: 200 });
    }));
    render(<App />);
    await screen.findByRole('button', { name: /newest-model/i });

    await userEvent.click(screen.getAllByRole('button', { name: 'Clear' })[0]);
    expect(screen.getByRole('dialog')).toBeVisible();
    await userEvent.click(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resets pagination and selection state after clearing', async () => {
    window.history.replaceState(null, '', '/_pp/?capture=newest-capture&tab=input-diff');
    let cleared = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/_pp/api/logs' && init?.method === 'DELETE') {
        cleared = true;
        return new Response(JSON.stringify({ cleared: true }));
      }
      if (isLogsPage(url)) return new Response(JSON.stringify(capturePage(cleared ? [] : captures.slice(0, 1))));
      if (url.includes('/input-diff/')) return new Response(JSON.stringify(details['newest-capture']));
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('button', { name: /newest-model/i });

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear' }));

    expect(await screen.findByText('No requests yet')).toBeVisible();
    expect(new URLSearchParams(window.location.search).get('capture')).toBeNull();
    expect(screen.getByText('0')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/_pp/api/logs', { method: 'DELETE' });
  });
});
