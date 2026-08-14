import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { DetailTabRegistry, defineDetailTab } from './dashboard.js';

const plugin = (id: string, order: number) => defineDetailTab({ id, label: id, order, Panel: () => null });

describe('DetailTabRegistry', () => {
  it('sorts by order while preserving registration order for ties', () => {
    expect(new DetailTabRegistry([plugin('raw', 20), plugin('diff', 10), plugin('trace', 20)]).plugins.map(({ id }) => id)).toEqual(['diff', 'raw', 'trace']);
  });

  it.each(['Bad ID', 'logs', 'assets', 'brand'])('rejects invalid or reserved ID %s', (id) => {
    expect(() => new DetailTabRegistry([plugin(id, 1)])).toThrow();
  });

  it('rejects duplicate IDs', () => {
    expect(() => new DetailTabRegistry([plugin('diff', 1), plugin('diff', 2)])).toThrow(/Duplicate/);
  });

  it('wraps optional data loading and renders the declared panel', async () => {
    const Panel = ({ value }: { value: string }) => createElement('span', null, value);
    const definition = defineDetailTab({
      id: 'loaded', label: 'Loaded', order: 1, Panel,
      load: async (_capture, signal) => { expect(signal).toBeInstanceOf(AbortSignal); return 'data'; },
    });
    expect(definition.load).toBeDefined();
    expect(await definition.load!({ id: 'capture' } as never, new AbortController().signal)).toBe('data');
    expect(definition.render({ value: 'rendered' })).toMatchObject({ type: Panel });
  });
});
