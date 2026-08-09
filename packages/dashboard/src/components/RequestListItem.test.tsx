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
  it('shows request health and selects without interpreting model text as HTML', async () => {
    const onSelect = vi.fn();
    const { container } = render(<RequestListItem capture={capture} selected onSelect={onSelect} />);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Below expected')).toBeVisible();
    expect(screen.getByText('43%')).toBeVisible();
    await userEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith(capture.id);
  });
});
