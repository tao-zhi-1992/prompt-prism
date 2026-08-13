const TRACE_COLOR_COUNT = 8;

/** Return a stable, theme-friendly palette slot for a trace identifier. */
export function traceColorIndex(traceId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < traceId.length; index += 1) {
    hash ^= traceId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % TRACE_COLOR_COUNT;
}
