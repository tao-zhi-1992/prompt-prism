import { describe, expect, it } from 'vitest';
import { traceColorIndex } from '../dashboard/colors.js';

describe('traceColorIndex', () => {
  it('keeps a trace color stable and within the palette', () => {
    const value = traceColorIndex('agent-session:one');
    expect(traceColorIndex('agent-session:one')).toBe(value);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(8);
  });

  it('separates representative trace identifiers', () => {
    expect(traceColorIndex('trace-a')).not.toBe(traceColorIndex('trace-b'));
  });
});
