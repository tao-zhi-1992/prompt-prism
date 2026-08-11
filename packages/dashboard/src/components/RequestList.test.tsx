import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CaptureSummary } from '../types';
import { RequestList } from './RequestList';

function captures(count: number): CaptureSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `capture-${String(index).padStart(5, '0')}`,
    timestamp: new Date(Date.UTC(2026, 7, 11, 0, 0, count - index)).toISOString(),
    token_hash: String(index),
    model: `model-${index}`,
    file_ref: `${index}.json`,
    response_status: 200,
  }));
}

function props(items: CaptureSummary[]) {
  return {
    captures: items,
    selectedId: null,
    loading: false,
    error: null as string | null,
    hasOlder: false,
    olderLoading: false,
    olderError: null as string | null,
    newCount: 0,
    onSelect: vi.fn(),
    onRetry: vi.fn(),
    onLoadOlder: vi.fn(),
    onShowNew: vi.fn(),
    onAtTopChange: vi.fn(),
  };
}

describe('RequestList', () => {
  it('keeps thousands of captures to a viewport-sized number of DOM rows', async () => {
    const handlers = props(captures(5_000));
    const { container } = render(<RequestList {...handlers} />);

    expect(container.querySelectorAll('.request-virtual-row').length).toBeLessThanOrEqual(40);
    await userEvent.click(screen.getByRole('button', { name: /model-5/i }));
    expect(handlers.onSelect).toHaveBeenCalledWith('capture-00005');

    const viewport = container.querySelector<HTMLElement>('.scroll-viewport')!;
    viewport.scrollTop = 6_400;
    fireEvent.scroll(viewport);
    await waitFor(() => expect(screen.getByText('model-100')).toBeVisible());
    await userEvent.click(screen.getByText('model-100').closest('button')!);
    expect(handlers.onSelect).toHaveBeenCalledWith('capture-00100');
    expect(container.querySelectorAll('.request-virtual-row').length).toBeLessThanOrEqual(40);
  });

  it('loads history when the end marker enters the rendered window', async () => {
    const handlers = props(captures(2));
    handlers.hasOlder = true;
    render(<RequestList {...handlers} />);
    await waitFor(() => expect(handlers.onLoadOlder).toHaveBeenCalledTimes(1));
  });

  it('keeps loaded rows visible and offers an independent history retry', async () => {
    const handlers = props(captures(2));
    handlers.hasOlder = true;
    handlers.olderError = 'network failed';
    render(<RequestList {...handlers} />);

    expect(screen.getByText('model-0')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Couldn’t load older requests · Retry' }));
    expect(handlers.onLoadOlder).toHaveBeenCalledTimes(1);
  });
});
