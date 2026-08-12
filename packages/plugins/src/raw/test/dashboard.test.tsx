import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { parseJsonObject, RawPanel, type RawCapture } from '../dashboard/RawPanel.js';

describe('RawPanel', () => {
  it('renders sorted headers, status, raw text, and unavailable data', () => {
    const raw: RawCapture = {
      request: { method: 'POST', url: '/v1/messages', target_url: 'http://provider.example.com/v1/messages', headers: { zebra: 'last', alpha: 'first' }, body: 'not json' },
      response: { status: 503, headers: {}, body: '' },
    };
    const { rerender } = render(<RawPanel raw={raw} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText('http://provider.example.com/v1/messages')).toBeVisible();
    expect(screen.getByText('/v1/messages')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Request' })).getAllByRole('term').map((node) => node.textContent)).toEqual(['alpha', 'zebra']);
    expect(screen.getByText('503')).toHaveClass('http-status--bad');
    rerender(<RawPanel raw={{ request: null, response: null }} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText(/Raw request data is unavailable/)).toBeVisible();
  });

  it('copies raw headers and bodies without changing their rendering', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<RawPanel raw={{
      request: { method: 'POST', url: '/', headers: { zebra: 'last', alpha: 'first' }, body: '# remains raw' },
      response: null,
    }} loading={false} error={null} onRetry={vi.fn()} />);
    const copies = screen.getAllByRole('button', { name: 'Copy' });
    await userEvent.click(copies[0]!);
    await userEvent.click(copies[1]!);
    expect(writeText).toHaveBeenNthCalledWith(1, '{\n  "alpha": "first",\n  "zebra": "last"\n}');
    expect(writeText).toHaveBeenNthCalledWith(2, '# remains raw');
    expect(screen.queryByRole('heading', { name: 'remains raw' })).not.toBeInTheDocument();
  });

  it('shows JSON fully expanded and recognizes only objects and arrays', () => {
    render(<RawPanel raw={{
      request: { method: 'POST', url: '/', headers: {}, body: JSON.stringify({ deep: { value: true } }) },
      response: null,
    }} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByRole('tree', { name: 'Request JSON body' })).toBeVisible();
    expect(screen.getAllByLabelText('Collapse JSON node').length).toBeGreaterThan(0);
    expect(parseJsonObject('42')).toBeNull();
  });

  it('shows retryable errors', async () => {
    const retry = vi.fn();
    render(<RawPanel raw={null} loading={false} error="network failed" onRetry={retry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
