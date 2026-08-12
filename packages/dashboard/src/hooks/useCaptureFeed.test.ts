import { describe, expect, it } from 'vitest';
import type { CaptureSummary } from '../types';
import { captureFeedReducer, initialCaptureFeedState, mergeCaptures } from './useCaptureFeed';

const capture = (id: string, timestamp: string): CaptureSummary => ({
  id, timestamp, token_hash: id, model: id, file_ref: `${id}.json`,
});

describe('capture feed state', () => {
  it('deduplicates and stably sorts merged pages', () => {
    const newer = capture('newer', '2026-08-12T02:00:00.000Z');
    const older = capture('older', '2026-08-12T01:00:00.000Z');
    expect(mergeCaptures([older], [newer, { ...older, model: 'updated' }])).toEqual([newer, { ...older, model: 'updated' }]);
  });

  it('applies an initial page atomically', () => {
    const item = capture('one', '2026-08-12T01:00:00.000Z');
    const state = captureFeedReducer(initialCaptureFeedState, { type: 'initialLoaded', page: {
      items: [item], total: 10, oldest_cursor: 'old', newest_cursor: 'new', has_older: true, has_newer: false,
    } });
    expect(state).toMatchObject({ captures: [item], totalCaptures: 10, oldestCursor: 'old', newestCursor: 'new', hasOlder: true, listLoading: false, listError: null });
  });

  it('stages polling results while browsing history and merges them on demand', () => {
    const existing = capture('existing', '2026-08-12T01:00:00.000Z');
    const incoming = capture('incoming', '2026-08-12T02:00:00.000Z');
    const initial = { ...initialCaptureFeedState, captures: [existing], isAtTop: false, listLoading: false };
    const staged = captureFeedReducer(initial, { type: 'pollLoaded', items: [incoming], total: 2, newestCursor: 'next', stage: true });
    expect(staged.captures).toEqual([existing]);
    expect(staged.pendingCaptures).toEqual([incoming]);
    expect(captureFeedReducer(staged, { type: 'showPending' }).captures).toEqual([incoming, existing]);
  });

  it('preserves loaded captures on refresh and older-page failures', () => {
    const existing = capture('existing', '2026-08-12T01:00:00.000Z');
    const state = { ...initialCaptureFeedState, captures: [existing], listLoading: false };
    const refreshFailed = captureFeedReducer(state, { type: 'pollFailed', error: 'offline' });
    const olderFailed = captureFeedReducer(refreshFailed, { type: 'olderFailed', error: 'retry' });
    expect(olderFailed.captures).toEqual([existing]);
    expect(olderFailed).toMatchObject({ listError: 'offline', olderError: 'retry', olderLoading: false });
  });

  it('resets the complete feed and advances list generation after clear', () => {
    const state = { ...initialCaptureFeedState, captures: [capture('one', '2026-08-12T01:00:00.000Z')], totalCaptures: 1, generation: 4 };
    expect(captureFeedReducer(state, { type: 'cleared' })).toEqual({ ...initialCaptureFeedState, generation: 5 });
  });
});
