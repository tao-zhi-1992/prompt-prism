import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
  it('orders sections, expands changes, and collapses unchanged secondary input', async () => {
    const { container } = render(<InputDiffPanel loading={false} error={null} onRetry={vi.fn()} analysis={analysis} />);
    expect(screen.getByText('Compared with parent-r')).toBeVisible();
    expect(screen.getByRole('table', { name: 'Messages diff with line numbers' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'System diff with line numbers' })).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Tools diff with line numbers' })).not.toBeInTheDocument();
    expect([...container.querySelectorAll('.input-diff-section-header > span:first-child')].map((node) => node.textContent)).toEqual(['Messages', 'System', 'Tools']);

    await userEvent.click(screen.getByRole('button', { name: /Messages/ }));
    expect(screen.queryByRole('table', { name: 'Messages diff with line numbers' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Tools/ }));
    expect(screen.getByRole('table', { name: 'Tools diff with line numbers' })).toBeVisible();
  });

  it('adapts legacy analysis to Messages and unavailable secondary sections', () => {
    render(<InputDiffPanel loading={false} error={null} onRetry={vi.fn()} analysis={{ ...analysis, matched_parent_id: null, sections: undefined, diff: [{ type: 'insert', value: '{"content":"first\\nsecond"}' }] }} />);
    expect(screen.getByText('No related request')).toBeVisible();
    expect(screen.getAllByText('Unavailable for historical capture')).toHaveLength(3);
    expect(screen.getByText(/second/)).toBeVisible();
  });
});
