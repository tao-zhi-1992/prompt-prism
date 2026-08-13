import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RequestListItem } from './RequestListItem';
import type { CaptureSummary } from '../types';

const capture: CaptureSummary = {
  id: 'capture-123456789',
  timestamp: '2026-08-09T06:00:00.000Z',
  token_hash: '0123456789abcdef',
  model: '<img src=x onerror=alert(1)>',
  file_ref: 'capture.json',
  usage: { input_tokens: 100, cache_read_input_tokens: 75 },
  response_status: 200,
  upstream_host: 'api.stepfun.com',
  trace_group_id: 'session:one',
  trace_group_source: 'explicit',
  trace_group_index: 2,
  analysis: {
    id: 'capture-123456789',
    timestamp: '2026-08-09T06:00:00.000Z',
    matched_parent_id: 'parent-id',
    matched_message_count: 2,
    divergence_point: 40,
    estimated_cacheable_tokens: 10,
    actual_cache_read_tokens: 5,
    estimated_cache_miss: 5,
    cache_hit_below_expected: true,
  },
};

describe('RequestListItem', () => {
  it('shows host, status, capture hash, and trace badge without interpreting model text as HTML', async () => {
    const onSelect = vi.fn();
    const onTraceClick = vi.fn();
    const { container } = render(<RequestListItem capture={capture} selected onSelect={onSelect} onTraceClick={onTraceClick} />);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('HTTP 200')).toHaveClass('status-label--good');
    expect(screen.getByText('capture-')).toHaveAttribute('title', capture.id);
    expect(screen.getByText('api.stepfun.com')).toHaveAttribute('title', 'api.stepfun.com');
    const traceBadge = screen.getByRole('button', { name: /Open trace session: request 2 from its first request/ });
    expect(traceBadge).toHaveTextContent('trace:session: #2');
    expect(traceBadge).toHaveAttribute('title', 'session:one');
    expect(traceBadge).not.toHaveAttribute('style');
    expect(traceBadge.className).toMatch(/trace-color-[0-7]/);
    expect([...container.querySelector('.request-line--secondary')!.children].map((child) => child.textContent)).toEqual([
      'HTTP 200',
      'capture-',
    ]);
    expect(screen.queryByText('Below expected')).not.toBeInTheDocument();
    expect(screen.queryByText(/cached/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /<img/i }));
    expect(onSelect).toHaveBeenCalledWith(capture.id);
    await userEvent.click(screen.getByRole('button', { name: /Open trace session: request 2 from its first request/ }));
    expect(onTraceClick).toHaveBeenCalledWith(capture.id);
  });

  it('labels inferred multi-capture groups separately from explicit traces', () => {
    render(<RequestListItem
      capture={{ ...capture, trace_group_id: 'root-capture', trace_group_source: 'inferred', trace_group_index: 1 }}
      selected={false}
      onSelect={vi.fn()}
      onTraceClick={vi.fn()}
    />);
    expect(screen.getByRole('button', { name: /Open trace root-cap request 1 from its first request/ })).toHaveTextContent('trace:root-cap #1');
  });

  it.each([
    [302, 'bad'],
    [401, 'bad'],
    [503, 'bad'],
    [undefined, 'neutral'],
  ] as const)('uses HTTP-only status coloring for %s', (responseStatus, tone) => {
    const { container } = render(<RequestListItem
      capture={{ ...capture, response_status: responseStatus }}
      selected={false}
      onSelect={vi.fn()}
      onTraceClick={vi.fn()}
    />);
    expect(screen.getByText(responseStatus === undefined ? 'HTTP —' : `HTTP ${responseStatus}`)).toHaveClass(`status-label--${tone}`);
    expect(container.querySelector('.status-dot')).toHaveClass(`status-dot--${tone}`);
  });
});
