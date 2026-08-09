import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RawCapture } from '../types';
import { parseJsonObject, RawPanel } from './RawPanel';

describe('RawPanel', () => {
  it('renders sorted headers, raw text, empty bodies, and unavailable legacy data', () => {
    const raw: RawCapture = {
      request: { method: 'POST', url: '/v1/messages', headers: { zebra: 'last', alpha: 'first' }, body: 'not json' },
      response: { status: 503, headers: { 'content-type': 'text/event-stream' }, body: '' },
    };
    const { rerender } = render(<RawPanel raw={raw} loading={false} error={null} onRetry={vi.fn()} />);

    const request = screen.getByRole('region', { name: 'Request' });
    expect(within(request).getAllByRole('term').map((node) => node.textContent)).toEqual(['alpha', 'zebra']);
    expect(within(request).getByText('not json')).toBeVisible();
    expect(screen.getByText('(empty body)')).toBeVisible();
    expect(screen.getByText('503')).toHaveClass('raw-status--error');

    rerender(<RawPanel raw={{ request: null, response: null }} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText(/Raw request data is unavailable/)).toBeVisible();
    expect(screen.getByText(/Raw response data is unavailable/)).toBeVisible();
  });

  it('shows JSON as an accessible tree with all nodes expanded by default', () => {
    const raw: RawCapture = {
      request: {
        method: 'POST', url: '/v1/messages', headers: {},
        body: JSON.stringify({ messages: [{ content: { text: 'deep value' } }], enabled: true }),
      },
      response: { status: 200, headers: {}, body: 'event: done\ndata: {}\n\n' },
    };
    render(<RawPanel raw={raw} loading={false} error={null} onRetry={vi.fn()} />);

    expect(screen.getByRole('tree', { name: 'Request JSON body' })).toBeVisible();
    expect(screen.getByText(/deep value/)).toBeVisible();
    const tree = screen.getByRole('tree', { name: 'Request JSON body' });
    expect(within(tree).getAllByLabelText('Collapse JSON node').length).toBeGreaterThan(0);
    expect(screen.getByText(/event: done/)).toBeVisible();
  });

  it('recognizes only object and array JSON values as tree data', () => {
    expect(parseJsonObject('{"ok":true}')).toEqual({ ok: true });
    expect(parseJsonObject('[1,2]')).toEqual([1, 2]);
    expect(parseJsonObject('42')).toBeNull();
    expect(parseJsonObject('invalid')).toBeNull();
    expect(parseJsonObject('')).toBeNull();
  });

  it('shows loading and retryable errors', async () => {
    const retry = vi.fn();
    const { rerender } = render(<RawPanel raw={null} loading error={null} onRetry={retry} />);
    expect(screen.getByText('Loading raw data…')).toBeVisible();
    rerender(<RawPanel raw={null} loading={false} error="network failed" onRetry={retry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
