import { useEffect } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { ScrollArea } from '@base-ui/react/scroll-area';
import { buildFormattedDiff, type DiffPart } from './formattedDiff.js';
import { useI18n, type TranslationKey } from '../../i18n/index.js';
import { Button } from '@prompt-prism/ui';

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
  return state;
}

function diffHref(captureId: string, sectionId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('capture', captureId);
  url.searchParams.set('tab', 'input-diff');
  url.hash = `input-diff-section-${sectionId}`;
  return `${url.pathname}${url.search}${url.hash}`;
}

function diffAnchor(sectionId: string): string {
  return `input-diff-section-${sectionId}`;
}

function sectionKey(id: string): TranslationKey | null {
  return ({ messages: 'section.messages', system: 'section.system', tools: 'section.tools', options: 'section.options' } as const)[id as 'messages'] ?? null;
}

function DiffCode({ section, hasParent }: { section: InputDiffSection; hasParent: boolean }) {
  const { t } = useI18n();
  const label = sectionKey(section.id) ? t(sectionKey(section.id)!) : section.label;
  if (section.state === 'unavailable') return null;
  const rows = buildFormattedDiff(section.diff, hasParent);
  return (
    <div className={`diff-code${hasParent ? '' : ' diff-code--baseline'}`} role="table" aria-label={t('diff.lineLabel', { section: label })}>
      {rows.map((row, lineIndex) => (
        <div className={`diff-line diff-line--${row.type}`} role="row" key={lineIndex}>
          <span className="diff-line-number" role="rowheader" aria-label={row.oldLineNumber ? t('diff.oldLine', { line: row.oldLineNumber }) : undefined} aria-hidden={row.oldLineNumber === null}>{row.oldLineNumber ?? ''}</span>
          <span className="diff-line-number diff-line-number--new" role="rowheader" aria-label={row.newLineNumber ? t('diff.newLine', { line: row.newLineNumber }) : undefined} aria-hidden={row.newLineNumber === null}>{row.newLineNumber ?? ''}</span>
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
  const { t } = useI18n();
  const key = sectionKey(section.id);
  return (
    <Collapsible.Trigger className="input-diff-section-header ui-interactive">
      <span>{key ? t(key) : section.label}</span>
      <span className={`input-diff-section-state input-diff-section-state--${section.state}`}>{t(`diff.state.${statusLabel(section.state)}` as TranslationKey)}</span>
      <span className="input-diff-chevron" aria-hidden="true" />
    </Collapsible.Trigger>
  );
}

function InputSection({ section, hasParent }: { section: InputDiffSection; hasParent: boolean }) {
  const content = <div className="input-diff-section-content"><DiffCode section={section} hasParent={hasParent} /></div>;
  return (
    <Collapsible.Root id={diffAnchor(section.id)} className="input-diff-section" defaultOpen={!section.default_collapsed || section.state === 'changed'}>
      <SectionHeader section={section} />
      <Collapsible.Panel className="input-diff-section-panel">{content}</Collapsible.Panel>
    </Collapsible.Root>
  );
}

export function InputDiffPanel({ analysis, loading, error, onRetry, selectCapture }: { analysis: InputDiffAnalysis | null; loading: boolean; error: string | null; onRetry: () => void; selectCapture?: (id: string, tab?: string, anchor?: string) => void }) {
  const { t } = useI18n();
  useEffect(() => {
    if (!analysis) return;
    const hash = window.location.hash.slice(1);
    const section = document.getElementById(hash.startsWith('input-diff-section-') ? hash : diffAnchor('messages'));
    if (!(section instanceof HTMLElement)) return;
    const trigger = section.querySelector<HTMLButtonElement>('.input-diff-section-header');
    if (trigger?.getAttribute('aria-expanded') !== 'true') trigger?.click();
    const frame = window.requestAnimationFrame(() => {
      const target = section.querySelector<HTMLElement>('.diff-line--insert, .diff-line--delete') ?? section;
      const viewport = section.closest<HTMLElement>('.input-diff-scroll')?.querySelector<HTMLElement>('.scroll-viewport');
      if (viewport) {
        const top = viewport.scrollTop + target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12;
        viewport.scrollTo?.({ top: Math.max(0, top), behavior: 'auto' });
      } else target.scrollIntoView?.({ behavior: 'auto', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [analysis?.id]);
  if (loading) return <div className="detail-message"><span className="spinner" />{t('diff.loading')}</div>;
  if (error) return <div className="detail-message detail-message--error"><strong>{t('diff.loadFailed')}</strong><span>{error}</span><Button onClick={onRetry}>{t('common.tryAgain')}</Button></div>;
  if (!analysis) return null;
  const hasParent = Boolean(analysis.matched_parent_id);
  const handleParentClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!selectCapture || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    selectCapture(analysis.matched_parent_id!, 'input-diff', diffAnchor('messages'));
  };
  return (
    <div className="input-diff-panel">
      <div className="input-diff-toolbar">
        {hasParent ? <a className="input-diff-parent-link" href={diffHref(analysis.matched_parent_id!, 'messages')} onClick={handleParentClick}>{t('diff.comparedWith', { id: analysis.matched_parent_id!.slice(0, 8) })}</a> : <span>{t('diff.noRelated')}</span>}
        {hasParent && <div className="diff-legend"><span className="legend-delete">{t('diff.removed')}</span><span className="legend-insert">{t('diff.added')}</span></div>}
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
