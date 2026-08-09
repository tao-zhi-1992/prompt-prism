import { ScrollArea } from '@base-ui/react/scroll-area';
import { buildFormattedDiff, type DiffPart } from './formattedDiff.js';

export interface Analysis {
  id: string;
  timestamp: string;
  matched_parent_id: string | null;
  matched_message_count: number;
  divergence_point: number;
  diff: DiffPart[];
  estimated_cacheable_tokens: number;
  actual_cache_read_tokens: number;
  estimated_cache_miss: number;
  cache_hit_below_expected: boolean;
}

export function DiffPanel({ analysis, loading, error, onRetry }: { analysis: Analysis | null; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <div className="detail-message"><span className="spinner" />Loading diff…</div>;
  if (error) return <div className="detail-message detail-message--error"><strong>Couldn’t load diff</strong><span>{error}</span><button onClick={onRetry}>Try again</button></div>;
  if (!analysis) return null;
  const hasParent = Boolean(analysis.matched_parent_id);
  const rows = buildFormattedDiff(analysis.diff, hasParent);
  return (
    <div className="diff-panel">
      <section className={`diff-viewer${hasParent ? '' : ' diff-viewer--baseline'}`}>
        {hasParent && <div className="diff-toolbar"><div className="diff-legend"><span className="legend-delete">Removed</span><span className="legend-insert">Added</span></div></div>}
        <ScrollArea.Root className="diff-scroll">
          <ScrollArea.Viewport className="scroll-viewport">
            <ScrollArea.Content>
              <div className={`diff-code${hasParent ? '' : ' diff-code--baseline'}`} role="table" aria-label="Character diff with line numbers">
                {rows.map((row, lineIndex) => (
                  <div className={`diff-line diff-line--${row.type}`} role="row" key={lineIndex}>
                    <span className="diff-line-number" role="rowheader" aria-label={row.oldLineNumber ? `Old line ${row.oldLineNumber}` : undefined} aria-hidden={row.oldLineNumber === null}>{row.oldLineNumber ?? ''}</span>
                    <span className="diff-line-number diff-line-number--new" role="rowheader" aria-label={row.newLineNumber ? `New line ${row.newLineNumber}` : undefined} aria-hidden={row.newLineNumber === null}>{row.newLineNumber ?? ''}</span>
                    <span className="diff-line-marker" aria-hidden="true">{row.type === 'delete' ? '−' : row.type === 'insert' ? '+' : ''}</span>
                    <code className="diff-line-content" role="cell">
                      {row.parts.map((part, partIndex) => <span className={`diff-${part.type}`} key={`${partIndex}-${part.type}`}>{part.value}</span>)}
                      {row.parts.length === 0 && '\u00a0'}
                    </code>
                  </div>
                ))}
              </div>
            </ScrollArea.Content>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar className="scrollbar"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
          <ScrollArea.Scrollbar className="scrollbar scrollbar--horizontal" orientation="horizontal"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
          <ScrollArea.Corner className="scrollbar-corner" />
        </ScrollArea.Root>
      </section>
    </div>
  );
}
