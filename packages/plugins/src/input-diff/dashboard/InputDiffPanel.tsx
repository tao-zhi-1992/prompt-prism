import { Collapsible } from '@base-ui/react/collapsible';
import { ScrollArea } from '@base-ui/react/scroll-area';
import { buildFormattedDiff, type DiffPart } from './formattedDiff.js';

export type InputDiffSectionState = 'changed' | 'unchanged' | 'baseline' | 'empty' | 'unavailable';

export interface InputDiffSection {
  id: string;
  label: string;
  order: number;
  state: InputDiffSectionState;
  default_collapsed: boolean;
  diff: DiffPart[];
}

export interface InputDiffAnalysis {
  id: string;
  timestamp: string;
  matched_parent_id: string | null;
  matched_message_count: number;
  divergence_point: number;
  diff: DiffPart[];
  sections?: InputDiffSection[];
  estimated_cacheable_tokens: number;
  actual_cache_read_tokens: number;
  estimated_cache_miss: number;
  cache_hit_below_expected: boolean;
}

function legacySections(analysis: InputDiffAnalysis): InputDiffSection[] {
  if (analysis.sections) return [...analysis.sections].sort((left, right) => left.order - right.order);
  const primaryState = analysis.matched_parent_id ? 'changed' : 'baseline';
  return [
    { id: 'messages', label: 'Messages', order: 10, state: primaryState, default_collapsed: false, diff: analysis.diff },
    ...['System', 'Tools', 'Request options'].map((label, index): InputDiffSection => ({
      id: ['system', 'tools', 'options'][index]!, label, order: 20 + index * 10,
      state: 'unavailable', default_collapsed: true, diff: [],
    })),
  ];
}

function statusLabel(state: InputDiffSectionState): string {
  if (state === 'empty') return 'Not set';
  if (state === 'unavailable') return 'Unavailable for historical capture';
  return state[0]!.toUpperCase() + state.slice(1);
}

function DiffCode({ section, hasParent }: { section: InputDiffSection; hasParent: boolean }) {
  if (section.state === 'unavailable') return null;
  const rows = buildFormattedDiff(section.diff, hasParent);
  return (
    <div className={`diff-code${hasParent ? '' : ' diff-code--baseline'}`} role="table" aria-label={`${section.label} diff with line numbers`}>
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
  );
}

function SectionHeader({ section }: { section: InputDiffSection }) {
  return (
    <Collapsible.Trigger className="input-diff-section-header">
      <span>{section.label}</span>
      <span className={`input-diff-section-state input-diff-section-state--${section.state}`}>{statusLabel(section.state)}</span>
      <span className="input-diff-chevron" aria-hidden="true" />
    </Collapsible.Trigger>
  );
}

function InputSection({ section, hasParent }: { section: InputDiffSection; hasParent: boolean }) {
  const content = <div className="input-diff-section-content"><DiffCode section={section} hasParent={hasParent} /></div>;
  return (
    <Collapsible.Root className="input-diff-section" defaultOpen={!section.default_collapsed || section.state === 'changed'}>
      <SectionHeader section={section} />
      <Collapsible.Panel className="input-diff-section-panel">{content}</Collapsible.Panel>
    </Collapsible.Root>
  );
}

export function InputDiffPanel({ analysis, loading, error, onRetry }: { analysis: InputDiffAnalysis | null; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <div className="detail-message"><span className="spinner" />Loading input diff…</div>;
  if (error) return <div className="detail-message detail-message--error"><strong>Couldn’t load input diff</strong><span>{error}</span><button onClick={onRetry}>Try again</button></div>;
  if (!analysis) return null;
  const hasParent = Boolean(analysis.matched_parent_id);
  return (
    <div className="input-diff-panel">
      <div className="input-diff-toolbar">
        <span>{hasParent ? `Compared with ${analysis.matched_parent_id!.slice(0, 8)}` : 'No related request'}</span>
        {hasParent && <div className="diff-legend"><span className="legend-delete">Removed</span><span className="legend-insert">Added</span></div>}
      </div>
      <ScrollArea.Root className="input-diff-scroll">
        <ScrollArea.Viewport className="scroll-viewport">
          <ScrollArea.Content className="input-diff-sections">
            {legacySections(analysis).map((section) => <InputSection section={section} hasParent={hasParent} key={section.id} />)}
          </ScrollArea.Content>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className="scrollbar"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
        <ScrollArea.Scrollbar className="scrollbar scrollbar--horizontal" orientation="horizontal"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
        <ScrollArea.Corner className="scrollbar-corner" />
      </ScrollArea.Root>
    </div>
  );
}
