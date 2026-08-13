import { Collapsible } from '@base-ui/react/collapsible';
import { ScrollArea } from '@base-ui/react/scroll-area';
import { Tooltip } from '@base-ui/react/tooltip';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type {
  ConversationContentBlock,
  ConversationMessage,
  JsonValue,
  ModelOutputBlock,
  ModelOutputSnapshot,
  Usage,
} from '../../contracts/dashboard.js';
import { useI18n, type TranslationKey } from '../../i18n/index.js';
import { Button } from '@prompt-prism/ui';
import { StructuredContent } from '../../content/StructuredContent.js';
import { traceColorIndex } from './colors.js';

export type TraceInputRelation = 'root' | 'append' | 'rewritten';
export interface TraceCall {
  capture_id: string;
  timestamp: string;
  model: string | null;
  response_status?: number | null;
  upstream_host?: string;
  input_relation: TraceInputRelation;
  input_delta: ConversationMessage[];
  output: ModelOutputSnapshot | null;
}
export interface TraceResult {
  id: string;
  source: 'explicit' | 'inferred';
  selected_capture_id: string;
  truncated: boolean;
  calls: TraceCall[];
}

function JsonBody({ value }: { value: JsonValue | null }) {
  const { t } = useI18n();
  return <StructuredContent value={value} mode="json" emptyFallback={t('common.empty')} />;
}

type ToolCallTarget = { anchorId: string; name: string; resultAnchorId?: string };
type ToolResultLink = { target: ToolCallTarget | null; toolCallId: string | null; anchorId: string };
type TraceEventLink = { toolCall?: ToolCallTarget; toolResult?: ToolResultLink };
type TraceLinkIndex = Map<string, TraceEventLink>;
type TraceEventKind = 'user' | 'thinking' | 'assistant' | 'tool-call' | 'tool-result' | 'unknown';
type ToolCallFocus = { captureId: string; id?: string; index?: number };

type EventLinkProps = {
  anchorId?: string;
  highlighted?: boolean;
  toolResultLink?: { target: ToolCallTarget | null; label: string; missing: boolean; missingLabel: string };
  toolCallLink?: { target: ToolCallTarget; label: string };
  onNavigate: (anchorId: string) => void;
};

function eventKey(callIndex: number, kind: 'input' | 'output', firstIndex: number, secondIndex: number) {
  return `${callIndex}:${kind}:${firstIndex}:${secondIndex}`;
}

function buildTraceLinkIndex(calls: TraceCall[]): TraceLinkIndex {
  const links: TraceLinkIndex = new Map();
  const targets = new Map<string, ToolCallTarget>();
  const blocks: Array<{ block: ConversationContentBlock | ModelOutputBlock; key: string; anchorId: string }> = [];
  const record = (block: ConversationContentBlock | ModelOutputBlock, key: string, anchorId: string) => {
    if (block.type === 'tool_call') {
      const target = { anchorId, name: block.name };
      if (block.id) targets.set(block.id, target);
    }
    blocks.push({ block, key, anchorId });
  };

  calls.forEach((call, callIndex) => {
    call.input_delta.forEach((message, messageIndex) => {
      message.content.forEach((block, blockIndex) => record(
        block,
        eventKey(callIndex, 'input', messageIndex, blockIndex),
        `trace-tool-call-${callIndex}-input-${messageIndex}-${blockIndex}`,
      ));
    });
    call.output?.content.filter(visibleOutput).forEach((block, blockIndex) => record(
      block,
      eventKey(callIndex, 'output', 0, blockIndex),
      `trace-tool-call-${callIndex}-output-${blockIndex}`,
    ));
  });
  for (const { block, key, anchorId } of blocks) {
    if (block.type === 'tool_call') links.set(key, { toolCall: targets.get(block.id ?? '') ?? { anchorId, name: block.name } });
    if (block.type === 'tool_result') {
      const target = block.tool_call_id ? targets.get(block.tool_call_id) ?? null : null;
      if (target) target.resultAnchorId = anchorId;
      links.set(key, { toolResult: { target, toolCallId: block.tool_call_id, anchorId } });
    }
  }
  return links;
}

function eventLinkProps(link: TraceEventLink | undefined, t: Translate, highlightedAnchorId: string | null, onNavigate: (anchorId: string) => void): EventLinkProps {
  const toolResult = link?.toolResult;
  return {
    anchorId: link?.toolCall?.anchorId ?? link?.toolResult?.anchorId,
    highlighted: (link?.toolCall?.anchorId ?? link?.toolResult?.anchorId) === highlightedAnchorId,
    toolResultLink: toolResult ? {
      target: toolResult.target,
      label: toolResult.target ? `${toolResult.target.name} →` : toolResult.toolCallId ?? t('trace.unknownTool'),
      missing: !toolResult.target,
      missingLabel: t('trace.toolResultNotFound'),
    } : undefined,
    toolCallLink: link?.toolCall?.resultAnchorId ? { target: link.toolCall, label: t('trace.resultLink') } : undefined,
    onNavigate,
  };
}

function TraceEventIcon({ kind }: { kind: TraceEventKind }) {
  const props = { className: 'trace-event-icon', viewBox: '0 0 16 16', 'aria-hidden': true } as const;
  if (kind === 'user') return <svg {...props}><circle cx="8" cy="5" r="2.25" /><path d="M3.5 13c.55-2.2 2.05-3.3 4.5-3.3s3.95 1.1 4.5 3.3" /></svg>;
  if (kind === 'thinking') return <svg {...props}><path d="m8 1.8.9 4.3 4.3.9-4.3.9-.9 4.3-.9-4.3L2.8 7l4.3-.9L8 1.8Z" /></svg>;
  if (kind === 'assistant') return <svg {...props}><path d="M2.2 3.2h11.6v7.7H6l-3.8 2.1v-2.1h0V3.2Z" /><path d="M5 6.6h.01M8 6.6h.01M11 6.6h.01" /></svg>;
  if (kind === 'tool-call') return <svg {...props}><path d="M2.5 3.2h11v9.6h-11z" /><path d="m5 6 2 2-2 2M8.5 10h2.5" /></svg>;
  if (kind === 'tool-result') return <svg {...props}><path d="M12.8 4.5H6.4a3.2 3.2 0 0 0 0 6.4h4.1" /><path d="m9 8.2 2.5 2.7-2.5 2.7" /></svg>;
  return <svg {...props}><circle cx="8" cy="8" r="5.5" /><path d="M6.2 6.1a1.9 1.9 0 1 1 3.1 1.5c-.8.6-1.3.9-1.3 2M8 12h.01" /></svg>;
}

function Toggle({ kind, label, emphasis, detail, toolResultLink, toolCallLink, onNavigate }: { kind: TraceEventKind; label: string; emphasis?: string | null; detail?: string | null; toolResultLink?: EventLinkProps['toolResultLink']; toolCallLink?: EventLinkProps['toolCallLink']; onNavigate: (anchorId: string) => void }) {
  const expandFromRow = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('button, a')) return;
    event.currentTarget.querySelector<HTMLButtonElement>('button')?.click();
  };
  const linkClick = (event: ReactMouseEvent<HTMLAnchorElement>, anchorId: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    onNavigate(anchorId);
  };
  return <div className="trace-event-toggle-row" onClick={expandFromRow}><div className="trace-event-title"><Collapsible.Trigger className="trace-event-toggle ui-interactive"><TraceEventIcon kind={kind} /><strong>{label}</strong>{emphasis && <b className="trace-tool-name" title={emphasis}>{emphasis}</b>}</Collapsible.Trigger>{toolResultLink && (toolResultLink.target ? <a className="trace-tool-result-link" href={`#${toolResultLink.target.anchorId}`} onClick={(event) => linkClick(event, toolResultLink.target!.anchorId)}>{toolResultLink.label}</a> : <span className="trace-tool-result-link trace-tool-result-link--missing">{toolResultLink.label}</span>)}{toolCallLink && <a className="trace-tool-result-link" href={`#${toolCallLink.target.resultAnchorId}`} aria-label={toolCallLink.label} onClick={(event) => linkClick(event, toolCallLink.target.resultAnchorId!)}>{toolCallLink.label}</a>}{toolResultLink?.missing && <span className="trace-tool-result-status">{toolResultLink.missingLabel}</span>}</div>{detail && <code>{detail}</code>}<span className="trace-chevron" aria-hidden="true" /></div>;
}

function Event({ kind, label, emphasis, detail, text, value, tone, anchorId, highlighted, toolCallId, toolCallCaptureId, toolCallIndex, toolResultLink, toolCallLink, onNavigate, open, onOpenChange }: {
  kind: TraceEventKind;
  label: string;
  emphasis?: string | null;
  detail?: string | null;
  text?: string;
  value?: JsonValue | null;
  tone?: 'error';
  anchorId?: string;
  highlighted?: boolean;
  toolCallId?: string | null;
  toolCallCaptureId?: string;
  toolCallIndex?: number;
  toolResultLink?: EventLinkProps['toolResultLink'];
  toolCallLink?: EventLinkProps['toolCallLink'];
  onNavigate: (anchorId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <Collapsible.Root id={anchorId} className={`trace-event${tone ? ` trace-event--${tone}` : ''}`} data-tool-highlight={highlighted || undefined} data-tool-call-id={toolCallId || undefined} data-tool-call-capture-id={toolCallCaptureId} data-tool-call-index={toolCallIndex} open={open} onOpenChange={onOpenChange}>
      <Toggle kind={kind} label={label} emphasis={emphasis} detail={detail} toolResultLink={toolResultLink} toolCallLink={toolCallLink} onNavigate={onNavigate} />
      <Collapsible.Panel className="trace-event-panel">
        {text !== undefined ? <StructuredContent value={text} emptyFallback={t('common.empty')} /> : <JsonBody value={value ?? null} />}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

type EventControls = { open: boolean; onOpenChange: (open: boolean) => void };

function conversationEvent(block: ConversationContentBlock, role: string, key: string, t: Translate, link: TraceEventLink | undefined, highlightedAnchorId: string | null, onNavigate: (anchorId: string) => void, controls: EventControls) {
  const linkProps = eventLinkProps(link, t, highlightedAnchorId, onNavigate);
  if (block.type === 'text') return <Event key={key} {...linkProps} {...controls} kind={role === 'user' ? 'user' : 'assistant'} label={role === 'user' ? t('trace.user') : t('trace.roleText', { role })} text={block.text} />;
  if (block.type === 'reasoning') return <Event key={key} {...linkProps} {...controls} kind="thinking" label={t('trace.thinking')} text={block.text} />;
  if (block.type === 'tool_call') return block.input_raw !== undefined
    ? <Event key={key} {...linkProps} {...controls} kind="tool-call" label={t('trace.toolCall')} emphasis={block.name} detail={`${block.id ? `${block.id} · ` : ''}${t('trace.invalidJson')}`} text={block.input_raw} />
    : <Event key={key} {...linkProps} {...controls} kind="tool-call" label={t('trace.toolCall')} emphasis={block.name} detail={block.id} value={block.input} />;
  if (block.type === 'tool_result') return <Event key={key} {...linkProps} {...controls} kind="tool-result" label={t('trace.toolResult')} detail={linkProps.toolResultLink?.missing ? null : block.tool_call_id} value={block.content} tone={block.is_error ? 'error' : undefined} />;
  return <Event key={key} {...linkProps} {...controls} kind="unknown" label={t('trace.unknownInput')} detail={block.provider_type} value={block.value} />;
}

function outputEvent(block: ModelOutputBlock, key: string, captureId: string, blockIndex: number, t: Translate, link: TraceEventLink | undefined, highlightedAnchorId: string | null, onNavigate: (anchorId: string) => void, controls: EventControls) {
  const linkProps = eventLinkProps(link, t, highlightedAnchorId, onNavigate);
  if (block.type === 'text') return <Event key={key} {...linkProps} {...controls} kind="assistant" label={t('trace.assistantText')} text={block.text} />;
  if (block.type === 'reasoning') return <Event key={key} {...linkProps} {...controls} kind="thinking" label={t('trace.thinking')} text={block.text} />;
  if (block.type === 'tool_call') return block.input_raw !== undefined
    ? <Event key={key} {...linkProps} {...controls} kind="tool-call" label={t('trace.toolCall')} emphasis={block.name} detail={`${block.id ? `${block.id} · ` : ''}${t('trace.invalidJson')}`} text={block.input_raw} toolCallId={block.id} toolCallCaptureId={captureId} toolCallIndex={blockIndex} />
    : <Event key={key} {...linkProps} {...controls} kind="tool-call" label={t('trace.toolCall')} emphasis={block.name} detail={block.id} value={block.input} toolCallId={block.id} toolCallCaptureId={captureId} toolCallIndex={blockIndex} />;
  return <Event key={key} {...linkProps} {...controls} kind="unknown" label={t('trace.unknownOutput')} detail={block.provider_type} value={block.value} />;
}

function visibleOutput(block: ModelOutputBlock): boolean {
  return block.type !== 'unknown' || block.provider_type !== 'openai_delta_fields';
}

function statusTone(status?: number | null) {
  if (status === undefined || status === null) return 'neutral';
  return status >= 200 && status < 300 ? 'good' : 'bad';
}

function captureHref(captureId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('capture', captureId);
  url.searchParams.set('tab', 'trace');
  return `${url.pathname}${url.search}`;
}

function toolCallFocusFromUrl(): ToolCallFocus | null {
  const params = new URLSearchParams(window.location.search);
  const captureId = params.get('capture');
  const id = params.get('tool_call_id');
  const rawIndex = params.get('tool_call_index');
  const index = rawIndex === null ? undefined : Number(rawIndex);
  if (!captureId || (!id && (index === undefined || !Number.isInteger(index) || index < 0))) return null;
  return { captureId, ...(id ? { id } : { index }) };
}

function scrollToTraceTarget(target: HTMLElement): void {
  const viewport = target.closest<HTMLElement>('.trace-scroll')?.querySelector<HTMLElement>('.scroll-viewport');
  if (!viewport) {
    target.scrollIntoView?.({ behavior: 'auto', block: 'center' });
    return;
  }
  const header = target.closest<HTMLElement>('.trace-call')?.querySelector<HTMLElement>('.trace-call-header-row');
  const top = viewport.scrollTop
    + target.getBoundingClientRect().top
    - viewport.getBoundingClientRect().top
    - (header?.getBoundingClientRect().height ?? 0)
    - 8;
  if (viewport.scrollTo) viewport.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  else viewport.scrollTop = Math.max(0, top);
}

type UsageSummary = {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  cacheHitRate: number | null;
};

function aggregateUsage(usages: Array<Usage | undefined>): UsageSummary {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let inputKnown = false;
  let outputKnown = false;
  let cacheKnown = false;
  for (const usage of usages) {
    if (!usage) continue;
    if (typeof usage.input_tokens === 'number') { input += usage.input_tokens; inputKnown = true; }
    if (typeof usage.output_tokens === 'number') { output += usage.output_tokens; outputKnown = true; }
    if (typeof usage.cache_read_input_tokens === 'number') { cacheRead += usage.cache_read_input_tokens; cacheKnown = true; }
    if (typeof usage.cache_creation_input_tokens === 'number') { cacheWrite += usage.cache_creation_input_tokens; cacheKnown = true; }
  }
  const totalInput = input + cacheRead + cacheWrite;
  return {
    input: inputKnown || cacheKnown ? totalInput : null,
    output: outputKnown ? output : null,
    cacheRead: cacheKnown ? cacheRead : null,
    cacheWrite: cacheKnown ? cacheWrite : null,
    cacheHitRate: cacheKnown && totalInput > 0 ? cacheRead / totalInput : null,
  };
}

function tokenValue(value: number | null, locale: string): string { return value === null ? '—' : new Intl.NumberFormat(locale).format(value); }
function rateValue(value: number | null): string { return value === null ? '—' : `${Math.round(value * 100)}%`; }

function UsageMetrics({ usage, compact = false }: { usage: UsageSummary; compact?: boolean }) {
  const { t, locale } = useI18n();
  const metrics = [
    { label: t(compact ? 'usage.input' : 'usage.inputTotal'), value: tokenValue(usage.input, locale), title: t('usage.inputTotalTitle') },
    { label: t('usage.output'), value: tokenValue(usage.output, locale) },
    { label: t('usage.cacheRead'), value: tokenValue(usage.cacheRead, locale) },
    { label: t('usage.cacheWrite'), value: tokenValue(usage.cacheWrite, locale) },
    { label: t('usage.cacheHit'), value: rateValue(usage.cacheHitRate) },
  ];
  return <dl className={compact ? 'trace-call-usage' : 'trace-usage'}>{metrics.map((metric) => <div key={metric.label}><dt title={metric.title}>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>;
}

function Call({ call, callIndex, selected, links, highlightedAnchorId, focusToolCall, onNavigate, selectCapture }: { call: TraceCall; callIndex: number; selected: boolean; links: TraceLinkIndex; highlightedAnchorId: string | null; focusToolCall: ToolCallFocus | null; onNavigate: (anchorId: string) => void; selectCapture?: (id: string) => void }) {
  const { t, locale } = useI18n();
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(() => new Set());
  const outputBlocks = call.output?.content.map((block, index) => ({ block, index })).filter(({ block }) => visibleOutput(block)) ?? [];
  const eventKeys = [
    ...call.input_delta.flatMap((message, messageIndex) => message.content.map((_, blockIndex) => eventKey(callIndex, 'input', messageIndex, blockIndex))),
    ...outputBlocks.map((_, blockIndex) => eventKey(callIndex, 'output', 0, blockIndex)),
  ];
  useEffect(() => {
    if (!focusToolCall || focusToolCall.captureId !== call.capture_id) return;
    const targetIndex = outputBlocks.findIndex(({ block, index }) => block.type === 'tool_call'
      && (focusToolCall.id ? block.id === focusToolCall.id : index === focusToolCall.index));
    if (targetIndex < 0) return;
    const key = eventKey(callIndex, 'output', 0, targetIndex);
    setExpandedEvents((current) => current.has(key) ? current : new Set(current).add(key));
  }, [call.capture_id, callIndex, focusToolCall, outputBlocks]);
  const eventControls = (key: string): EventControls => ({
    open: expandedEvents.has(key),
    onOpenChange: (open) => setExpandedEvents((current) => {
      const next = new Set(current);
      if (open) next.add(key); else next.delete(key);
      return next;
    }),
  });
  const setAllEvents = (open: boolean) => setExpandedEvents(open ? new Set(eventKeys) : new Set());
  const handleCaptureClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!selectCapture || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    selectCapture(call.capture_id);
  };
  const usage = aggregateUsage([call.output?.usage]);
  const hasUsage = Object.values(usage).some((value) => value !== null);
  return (
    <article className="trace-call" data-selected={selected || undefined}>
      <div className="trace-call-header-row detail-sticky-header">
        <a className="trace-call-header ui-interactive" href={captureHref(call.capture_id)} aria-label={t('trace.selectRequest', { id: call.capture_id })} onClick={handleCaptureClick}>
          <span className="trace-call-index">{call.capture_id.slice(0, 8)}</span>
          <span className="trace-call-model">{call.model ?? t('common.unknownModel')}</span>
          <span className="trace-call-host" title={call.upstream_host}>{call.upstream_host ?? t('common.unknownUpstream')}</span>
          <time dateTime={call.timestamp}>{new Date(call.timestamp).toLocaleTimeString(locale)}</time>
          <b className={`trace-http trace-http--${statusTone(call.response_status)}`}>HTTP {call.response_status ?? '—'}</b>
        </a>
        <div className="trace-call-actions">
          <button className="trace-call-action ui-interactive" type="button" onClick={() => setAllEvents(true)}>{t('trace.expandAll')}</button>
          <button className="trace-call-action ui-interactive" type="button" onClick={() => setAllEvents(false)}>{t('trace.collapseAll')}</button>
        </div>
      </div>
      {hasUsage && <UsageMetrics usage={usage} compact />}
      <div className="trace-events">
        {call.input_relation === 'rewritten' && <div className="trace-notice">{t('trace.inputRewritten')}</div>}
        {call.input_delta.flatMap((message, messageIndex) => message.content.map((block, blockIndex) => {
          const key = eventKey(callIndex, 'input', messageIndex, blockIndex);
          return conversationEvent(block, message.role, key, t, links.get(key), highlightedAnchorId, onNavigate, eventControls(key));
        }))}
        {call.output?.error && <div className="trace-provider-error"><strong>{call.output.error.type ?? t('trace.providerError')}</strong><span>{call.output.error.message}</span></div>}
        {outputBlocks.map(({ block, index }, blockIndex) => {
          const key = eventKey(callIndex, 'output', 0, blockIndex);
          return outputEvent(block, key, call.capture_id, index, t, links.get(key), highlightedAnchorId, onNavigate, eventControls(key));
        })}
        {!call.input_delta.length && !outputBlocks.length && !call.output?.error && <div className="trace-empty-event">{t('trace.noEvents')}</div>}
      </div>
    </article>
  );
}

function TraceSource({ source }: { source: TraceResult['source'] }) {
  const { t } = useI18n();
  if (source === 'explicit') return <div><span>{t('trace.source')}</span><b>{t('trace.explicit')}</b></div>;
  return (
    <div>
      <span>{t('trace.source')}</span>
      <div className="trace-source-value">
        <b>{t('trace.inferred')}</b>
        <Tooltip.Root>
          <Tooltip.Trigger className="trace-info-trigger" aria-label={t('trace.inferredHelpLabel')}>?</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner side="bottom" align="start" className="trace-tooltip-positioner">
              <Tooltip.Popup className="trace-tooltip">{t('trace.inferredHelpBefore')} <code>x-prompt-prism-trace-id</code> {t('trace.inferredHelpAfter')}</Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>
    </div>
  );
}

export function TracePanel({ trace, loading, error, refreshError, onRetry, selectCapture }: {
  trace: TraceResult | null;
  loading: boolean;
  error: string | null;
  refreshError: string | null;
  onRetry: () => void;
  selectCapture?: (id: string) => void;
}) {
  const { t } = useI18n();
  const linkIndex = useMemo(() => buildTraceLinkIndex(trace?.calls ?? []), [trace]);
  const [highlightedAnchorId, setHighlightedAnchorId] = useState<string | null>(null);
  const [focusToolCall, setFocusToolCall] = useState<ToolCallFocus | null>(() => toolCallFocusFromUrl());
  const highlightTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
  }, []);
  const navigateToToolResult = useCallback((anchorId: string) => {
    const target = document.getElementById(anchorId);
    if (!target) return;
    const toggle = target.querySelector<HTMLButtonElement>('.trace-event-toggle');
    if (toggle?.getAttribute('aria-expanded') !== 'true') toggle?.click();
    scrollToTraceTarget(target);
    setHighlightedAnchorId(anchorId);
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightedAnchorId(null), 1600);
  }, []);
  useEffect(() => {
    if (!trace || !focusToolCall) return;
    const target = [...document.querySelectorAll<HTMLElement>('[data-tool-call-capture-id]')].find((element) => (
      element.dataset.toolCallCaptureId === focusToolCall.captureId
      && (focusToolCall.id ? element.dataset.toolCallId === focusToolCall.id : element.dataset.toolCallIndex === String(focusToolCall.index))
    ));
    if (!target) return;
    scrollToTraceTarget(target);
    setHighlightedAnchorId(target.id);
    setFocusToolCall(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('tool_call_id');
    url.searchParams.delete('tool_call_index');
    window.history.replaceState(null, '', url);
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightedAnchorId(null), 1600);
  }, [focusToolCall, trace]);
  if (loading) return <div className="detail-message"><span className="spinner" />{t('trace.loading')}</div>;
  if (error) return <div className="detail-message detail-message--error"><strong>{t('trace.loadFailed')}</strong><span>{error}</span><Button onClick={onRetry}>{t('common.tryAgain')}</Button></div>;
  if (!trace) return null;
  const usage = aggregateUsage(trace.calls.map((call) => call.output?.usage));
  return (
    <div className={`trace-panel trace-color-${traceColorIndex(trace.id)}`}>
      <div className="trace-overview">
        <header className="trace-summary">
          <div><span>{t('tab.trace')}</span><code className="trace-summary-id" title={trace.id}>trace:{trace.id.slice(0, 8)}</code></div>
          <TraceSource source={trace.source} />
          <div><span>{t('trace.calls')}</span><b>{trace.calls.length}</b></div>
        </header>
        <UsageMetrics usage={usage} />
        {(trace.truncated || refreshError) && (
          <div className="trace-notices">
            <div className={`trace-warning${refreshError ? ' trace-warning--error' : ''}`}>{refreshError ? t('trace.refreshFailed', { error: refreshError }) : t('trace.beginningUnavailable')}</div>
          </div>
        )}
      </div>
      <ScrollArea.Root className="trace-scroll">
        <ScrollArea.Viewport className="scroll-viewport">
          <ScrollArea.Content className="trace-content">
            {[...trace.calls].reverse().map((call) => {
              const callIndex = trace.calls.indexOf(call);
              return <Call key={call.capture_id} call={call} callIndex={callIndex} selected={call.capture_id === trace.selected_capture_id} links={linkIndex} highlightedAnchorId={highlightedAnchorId} focusToolCall={focusToolCall} onNavigate={navigateToToolResult} selectCapture={selectCapture} />;
            })}
            {!trace.calls.length && <div className="trace-empty-event">{t('trace.noCalls')}</div>}
          </ScrollArea.Content>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className="scrollbar"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
        <ScrollArea.Scrollbar className="scrollbar scrollbar--horizontal" orientation="horizontal"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
        <ScrollArea.Corner className="scrollbar-corner" />
      </ScrollArea.Root>
    </div>
  );
}
