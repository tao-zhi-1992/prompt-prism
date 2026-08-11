import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputDiffPanel } from '../dashboard/InputDiffPanel.js';

const analysis = {
  id: 'current', timestamp: '2026-08-09T06:00:00.000Z', matched_parent_id: 'parent-request',
  matched_message_count: 1, divergence_point: 12, estimated_cacheable_tokens: 3,
  actual_cache_read_tokens: 1, estimated_cache_miss: 2, cache_hit_below_expected: true,
  diff: [{ type: 'equal' as const, value: '[{"role":"user"}]' }],
  sections: [
    { id: 'messages', label: 'Messages', order: 10, state: 'unchanged' as const, default_collapsed: false, diff: [{ type: 'equal' as const, value: '[{"role":"user"}]' }] },
    { id: 'system', label: 'System', order: 20, state: 'changed' as const, default_collapsed: true, diff: [{ type: 'delete' as const, value: '"old"' }, { type: 'insert' as const, value: '"new"' }] },
    { id: 'tools', label: 'Tools', order: 30, state: 'unchanged' as const, default_collapsed: true, diff: [{ type: 'equal' as const, value: '[]' }] },
  ],
};

describe('InputDiffPanel', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/_pp/');
  });

  it('orders sections, expands changes, and collapses unchanged secondary input', async () => {
    const { container } = render(<InputDiffPanel loading={false} error={null} onRetry={vi.fn()} analysis={analysis} />);
    const parentLink = screen.getByRole('link', { name: 'Compared with parent-r' });
    expect(parentLink).toBeVisible();
    expect(parentLink).toHaveAttribute('href', expect.stringContaining('capture=parent-request'));
    expect(parentLink).toHaveAttribute('href', expect.stringContaining('tab=input-diff'));
    expect(parentLink).toHaveAttribute('href', expect.stringContaining('#input-diff-section-messages'));
    expect(screen.getByRole('table', { name: 'Messages diff with line numbers' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'System diff with line numbers' })).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Tools diff with line numbers' })).not.toBeInTheDocument();
    expect([...container.querySelectorAll('.input-diff-section-header > span:first-child')].map((node) => node.textContent)).toEqual(['Messages', 'System', 'Tools']);

    await userEvent.click(screen.getByRole('button', { name: /Messages/ }));
    expect(screen.queryByRole('table', { name: 'Messages diff with line numbers' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Tools/ }));
    expect(screen.getByRole('table', { name: 'Tools diff with line numbers' })).toBeVisible();
  });

  it('uses SPA navigation for the parent link while preserving native modified clicks', async () => {
    const selectCapture = vi.fn();
    render(<InputDiffPanel loading={false} error={null} onRetry={vi.fn()} analysis={analysis} selectCapture={selectCapture} />);
    const parentLink = screen.getByRole('link', { name: 'Compared with parent-r' });

    await userEvent.click(parentLink);
    expect(selectCapture).toHaveBeenCalledWith('parent-request', 'input-diff', 'input-diff-section-messages');
    selectCapture.mockClear();
    const preventNativeNavigation = (event: MouseEvent) => event.preventDefault();
    parentLink.addEventListener('click', preventNativeNavigation);

    try {
      for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey'] as const) {
        fireEvent.click(parentLink, { [modifier]: true });
        expect(selectCapture).not.toHaveBeenCalled();
      }
    } finally {
      parentLink.removeEventListener('click', preventNativeNavigation);
    }
  });

  it('scrolls to the first changed row in Messages by default', async () => {
    const changedAnalysis = {
      ...analysis,
      sections: analysis.sections.map((section) => section.id === 'messages' ? {
        ...section,
        state: 'changed' as const,
        diff: [
          { type: 'delete' as const, value: '{"message":"old"}' },
          { type: 'insert' as const, value: '{"message":"new"}' },
        ],
      } : section),
    };
    const scrollTo = vi.fn();
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const rect = (top: number) => ({ x: 0, y: top, top, right: 0, bottom: top, left: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
    HTMLElement.prototype.scrollTo = scrollTo;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('scroll-viewport')) return rect(20);
      if (this.classList.contains('diff-line--delete')) return rect(120);
      if (this.classList.contains('diff-line--insert')) return rect(180);
      return rect(40);
    };

    try {
      const { container } = render(<InputDiffPanel loading={false} error={null} onRetry={vi.fn()} analysis={changedAnalysis} />);
      expect(container.querySelector('.diff-line--delete')).not.toBeNull();
      await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 88, behavior: 'auto' }));
    } finally {
      HTMLElement.prototype.scrollTo = originalScrollTo;
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });

  it('expands and scrolls to the section named by the URL hash', async () => {
    window.history.replaceState(null, '', '/_pp/?capture=current&tab=input-diff#input-diff-section-tools');
    const scrollTo = vi.fn();
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = scrollTo;

    try {
      render(<InputDiffPanel loading={false} error={null} onRetry={vi.fn()} analysis={analysis} />);
      await waitFor(() => expect(screen.getByRole('button', { name: /Tools/ })).toHaveAttribute('aria-expanded', 'true'));
      await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: expect.any(Number), behavior: 'auto' }));
    } finally {
      HTMLElement.prototype.scrollTo = originalScrollTo;
    }
  });

  it('adapts legacy analysis to Messages and unavailable secondary sections', () => {
    render(<InputDiffPanel loading={false} error={null} onRetry={vi.fn()} analysis={{ ...analysis, matched_parent_id: null, sections: undefined, diff: [{ type: 'insert', value: '{"content":"first\\nsecond"}' }] }} />);
    expect(screen.getByText('No related request')).toBeVisible();
    expect(screen.getAllByText('Unavailable for historical capture')).toHaveLength(3);
    expect(screen.getByText(/second/)).toBeVisible();
  });
});
