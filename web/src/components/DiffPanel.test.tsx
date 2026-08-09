import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DiffPanel } from './DiffPanel';

describe('DiffPanel', () => {
  it('renders equal, removed, and added character spans', () => {
    const { container } = render(<DiffPanel loading={false} error={null} onRetry={vi.fn()} analysis={{
      id: 'current', timestamp: '2026-08-09T06:00:00.000Z', matched_parent_id: 'parent-123456',
      matched_message_count: 1, divergence_point: 12, estimated_cacheable_tokens: 3,
      actual_cache_read_tokens: 1, estimated_cache_miss: 2, cache_hit_below_expected: true,
      diff: [{ type: 'equal', value: 'same' }, { type: 'delete', value: 'old' }, { type: 'insert', value: '<new>' }],
    }} />);
    expect(container.querySelector('.diff-equal')).toHaveTextContent('same');
    expect(container.querySelector('.diff-delete')).toHaveTextContent('old');
    expect(container.querySelector('.diff-insert')).toHaveTextContent('<new>');
    expect(screen.getByText('#parent-1')).toBeVisible();
  });

  it('presents a first request as a neutral baseline', () => {
    const { container } = render(<DiffPanel loading={false} error={null} onRetry={vi.fn()} analysis={{
      id: 'first', timestamp: '2026-08-09T06:00:00.000Z', matched_parent_id: null,
      matched_message_count: 0, divergence_point: 0, estimated_cacheable_tokens: 0,
      actual_cache_read_tokens: 0, estimated_cache_miss: 0, cache_hit_below_expected: false,
      diff: [{ type: 'insert', value: 'first prompt' }],
    }} />);
    expect(screen.getByText('No earlier request')).toBeVisible();
    expect(container.querySelector('.diff-insert')).toBeNull();
    expect(container.querySelector('.diff-equal')).toHaveTextContent('first prompt');
  });
});
