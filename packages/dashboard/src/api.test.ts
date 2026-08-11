import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNewCaptureBatch } from './api';
import type { CaptureSummary } from './types';

function capture(id: string): CaptureSummary {
  return { id, timestamp: `2026-08-11T00:00:0${id}.000Z`, token_hash: id, model: id, file_ref: `${id}.json` };
}

afterEach(() => vi.unstubAllGlobals());

describe('getNewCaptureBatch', () => {
  it('serially drains every newer page without skipping a burst', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [capture('2'), capture('1')], total: 5, oldest_cursor: 'c1', newest_cursor: 'c2', has_older: true, has_newer: true,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [capture('4'), capture('3')], total: 5, oldest_cursor: 'c3', newest_cursor: 'c4', has_older: true, has_newer: false,
      })));
    vi.stubGlobal('fetch', fetchMock);

    const batch = await getNewCaptureBatch('c0');

    expect(batch.items.map(({ id }) => id)).toEqual(['2', '1', '4', '3']);
    expect(batch).toMatchObject({ total: 5, newestCursor: 'c4' });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/_pp/api/logs?limit=100&after=c0',
      '/_pp/api/logs?limit=100&after=c2',
    ]);
  });

  it('stops if a malformed page does not advance its cursor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [], total: 1, oldest_cursor: null, newest_cursor: 'same', has_older: false, has_newer: true,
    })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getNewCaptureBatch('same')).resolves.toMatchObject({ newestCursor: 'same' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
