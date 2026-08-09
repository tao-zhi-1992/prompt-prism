import { ScrollArea } from '@base-ui/react/scroll-area';
import type { Analysis } from '../types';
import { formatNumber } from '../format';
import { buildFormattedDiff } from '../formattedDiff';

type Props = {
  analysis: Analysis | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
};

function Metric({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={`metric${alert ? ' metric--alert' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function DiffPanel({ analysis, loading, error, onRetry }: Props) {
  if (loading) return <div className="detail-message"><span className="spinner" />Loading diff…</div>;
  if (error) return <div className="detail-message detail-message--error"><strong>Couldn’t load diff</strong><span>{error}</span><button onClick={onRetry}>Try again</button></div>;
  if (!analysis) return null;

  const hasParent = Boolean(analysis.matched_parent_id);
  const rows = buildFormattedDiff(analysis.diff, hasParent);
  return (
    <div className="diff-panel">
      <section className="diff-summary" aria-label="Diff summary">
        <div className="parent-summary">
          <span className="eyebrow">Compared with</span>
          <strong>{hasParent ? `#${analysis.matched_parent_id!.slice(0, 8)}` : 'No earlier request'}</strong>
          <span>{hasParent ? `${analysis.matched_message_count} matching messages` : 'This request establishes the baseline.'}</span>
        </div>
        <div className="metrics">
          <Metric label="Divergence" value={formatNumber(analysis.divergence_point)} />
          <Metric label="Cacheable" value={`${formatNumber(analysis.estimated_cacheable_tokens)} tok`} />
          <Metric label="Cache read" value={`${formatNumber(analysis.actual_cache_read_tokens)} tok`} />
          <Metric label="Est. miss" value={`${formatNumber(analysis.estimated_cache_miss)} tok`} alert={analysis.cache_hit_below_expected} />
        </div>
      </section>

      <section className="diff-viewer">
        <div className="diff-toolbar">
          <span>Formatted JSON diff</span>
          {hasParent && <div className="diff-legend"><span className="legend-delete">Removed</span><span className="legend-insert">Added</span></div>}
        </div>
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
                      {row.parts.map((part, partIndex) => (
                        <span className={`diff-${part.type}`} key={`${partIndex}-${part.type}`}>{part.value}</span>
                      ))}
                      {row.parts.length === 0 && '\u00a0'}
                    </code>
                  </div>
                ))}
              </div>
            </ScrollArea.Content>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar className="scrollbar">
            <ScrollArea.Thumb className="scrollbar-thumb" />
          </ScrollArea.Scrollbar>
          <ScrollArea.Scrollbar className="scrollbar scrollbar--horizontal" orientation="horizontal">
            <ScrollArea.Thumb className="scrollbar-thumb" />
          </ScrollArea.Scrollbar>
          <ScrollArea.Corner className="scrollbar-corner" />
        </ScrollArea.Root>
      </section>
    </div>
  );
}
