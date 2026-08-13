import { describe, expect, it } from 'vitest';
import { TRACE_DISPLAY_NAMES, traceDisplayName } from '@prompt-prism/dashboard-kit';

describe('trace display names', () => {
  it('uses a fixed 256-name display-only palette', () => {
    expect(TRACE_DISPLAY_NAMES).toHaveLength(256);
    expect(new Set(TRACE_DISPLAY_NAMES).size).toBe(256);
  });

  it('maps every Trace ID deterministically without returning the raw ID', () => {
    const ids = ['session:one', '8707ac3b', 'root-capture', 'unicode-追踪'];
    for (const id of ids) {
      expect(traceDisplayName(id)).toBe(traceDisplayName(id));
      expect(TRACE_DISPLAY_NAMES).toContain(traceDisplayName(id));
      expect(traceDisplayName(id)).not.toBe(id);
    }
  });
});
