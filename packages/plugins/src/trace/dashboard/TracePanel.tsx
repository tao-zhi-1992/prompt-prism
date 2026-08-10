import { Collapsible } from '@base-ui/react/collapsible';
import { ScrollArea } from '@base-ui/react/scroll-area';
import { Tooltip } from '@base-ui/react/tooltip';
import { JsonView } from 'react-json-view-lite';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
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

const jsonStyles = {
  container: 'trace-json-tree', basicChildStyle: 'trace-json-child', childFieldsContainer: 'trace-json-children',
  label: 'trace-json-label', clickableLabel: 'trace-json-label trace-json-clickable', nullValue: 'trace-json-null',
  undefinedValue: 'trace-json-null', stringValue: 'trace-json-string', booleanValue: 'trace-json-boolean',
  numberValue: 'trace-json-number', otherValue: 'trace-json-other', punctuation: 'trace-json-punctuation',
  collapseIcon: 'trace-json-expander trace-json-expander--open', expandIcon: 'trace-json-expander trace-json-expander--closed',
  collapsedContent: 'trace-json-collapsed', quotesForFieldNames: true, stringifyStringValues: true,
};

function JsonBody({ value }: { value: JsonValue | null }) {
  const { t } = useI18n();
  if (value !== null && typeof value === 'object') return <JsonView data={value} style={{ ...jsonStyles, ariaLables: { collapseJson: t('json.collapse'), expandJson: t('json.expand') } }} shouldExpandNode={() => true} clickToExpandNode />;
  return <pre className="trace-code">{value === null ? t('common.empty') : JSON.stringify(value, null, 2)}</pre>;
}

type ToolCallTarget = { anchorId: string; name: string };
type ToolResultLink = { target: ToolCallTarget | null; toolCallId: string | null };
type TraceEventLink = { toolCall?: ToolCallTarget; toolResult?: ToolResultLink };
type TraceLinkIndex = Map<string, TraceEventLink>;

type EventLinkProps = {
  anchorId?: string;
  highlighted?: boolean;
  toolResultLink?: { target: ToolCallTarget | null; label: string; missing: boolean; missingLabel: string };
  onNavigate: (anchorId: string) => void;
};

function eventKey(callIndex: number, kind: 'input' | 'output', firstIndex: number, secondIndex: number) {
  return `${callIndex}:${kind}:${firstIndex}:${secondIndex}`;
}

function buildTraceLinkIndex(calls: TraceCall[]): TraceLinkIndex {
  const links: TraceLinkIndex = new Map();
  const targets = new Map<string, ToolCallTarget>();
  const record = (block: ConversationContentBlock | ModelOutputBlock, key: string, anchorId: string) => {
    if (block.type === 'tool_call') {
      const target = { anchorId, name: block.name };
      links.set(key, { toolCall: target });
      if (block.id) targets.set(block.id, target);
    } else if (block.type === 'tool_result') {
      links.set(key, { toolResult: { target: block.tool_call_id ? targets.get(block.tool_call_id) ?? null : null, toolCallId: block.tool_call_id } });
    }
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
  return links;
}

function eventLinkProps(link: TraceEventLink | undefined, t: Translate, highlightedAnchorId: string | null, onNavigate: (anchorId: string) => void): EventLinkProps {
  const toolResult = link?.toolResult;
  return {
    anchorId: link?.toolCall?.anchorId,
    highlighted: link?.toolCall?.anchorId === highlightedAnchorId,
    onNavigate,
    toolResultLink: toolResult ? {
      target: toolResult.target,
      label: toolResult.target?.name ?? toolResult.toolCallId ?? t('trace.unknownTool'),
      missing: !toolResult.target,
      missingLabel: t('trace.toolResultNotFound'),
    } : undefined,
  };
}

function Toggle({ label, emphasis, detail, toolResultLink, onNavigate }: { label: string; emphasis?: string | null; detail?: string | null; toolResultLink?: EventLinkProps['toolResultLink']; onNavigate: (anchorId: string) => void }) {
  const activateToolLink = (event: ReactMouseEvent | ReactKeyboardEvent) => {
    if (!toolResultLink?.target) return;
    event.preventDefault();
    event.stopPropagation();
    onNavigate(toolResultLink.target.anchorId);
  };
  return <Collapsible.Trigger className="trace-event-toggle ui-interactive"><span className="trace-event-title"><strong>{label}</strong>{emphasis && <b className="trace-tool-name" title={emphasis}>{emphasis}</b>}{toolResultLink && <><span
    className={`trace-tool-result-link${toolResultLink.missing ? ' trace-tool-result-link--missing' : ''}`}
    role="link"
    tabIndex={toolResultLink.target ? 0 : undefined}
    aria-label={toolResultLink.label}
    onClick={activateToolLink}
    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') activateToolLink(event); }}
  >{toolResultLink.label}</span>{toolResultLink.missing && <span className="trace-tool-result-status">{toolResultLink.missingLabel}</span>}</>}</span>{detail && <code>{detail}</code>}<span className="trace-chevron" aria-hidden="true" /></Collapsible.Trigger>;
}

function Event({ label, emphasis, detail, text, value, defaultOpen = false, tone, anchorId, highlighted, toolResultLink, onNavigate }: {
  label: string;
  emphasis?: string | null;
  detail?: string | null;
  text?: string;
  value?: JsonValue | null;
  defaultOpen?: boolean;
  tone?: 'error';
  anchorId?: string;
  highlighted?: boolean;
  toolResultLink?: EventLinkProps['toolResultLink'];
  onNavigate: (anchorId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Collapsible.Root id={anchorId} className={`trace-event${tone ? ` trace-event--${tone}` : ''}`} data-tool-highlight={highlighted || undefined} defaultOpen={defaultOpen}>
      <Toggle label={label} emphasis={emphasis} detail={detail} toolResultLink={toolResultLink} onNavigate={onNavigate} />
      <Collapsible.Panel className="trace-event-panel">
        {text !== undefined ? <pre className="trace-text">{text || t('common.empty')}</pre> : <JsonBody value={value ?? null} />}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

function conversationEvent(block: ConversationContentBlock, role: string, key: string, t: Translate, link: TraceEventLink | undefined, highlightedAnchorId: string | null, onNavigate: (anchorId: string) => void) {
  const linkProps = eventLinkProps(link, t, highlightedAnchorId, onNavigate);
  if (block.type === 'text') return <Event key={key} {...linkProps} label={role === 'user' ? t('trace.user') : t('trace.roleText', { role })} text={block.text} defaultOpen />;
  if (block.type === 'reasoning') return <Event key={key} {...linkProps} label={t('trace.thinking')} text={block.text} />;
  if (block.type === 'tool_call') return block.input_raw !== undefined
    ? <Event key={key} {...linkProps} label={t('trace.toolCall')} emphasis={block.name} detail={`${block.id ? `${block.id} · ` : ''}${t('trace.invalidJson')}`} text={block.input_raw} />
    : <Event key={key} {...linkProps} label={t('trace.toolCall')} emphasis={block.name} detail={block.id} value={block.input} />;
  if (block.type === 'tool_result') return <Event key={key} {...linkProps} label={t('trace.toolResult')} detail={linkProps.toolResultLink?.missing ? null : block.tool_call_id} value={block.content} tone={block.is_error ? 'error' : undefined} />;
  return <Event key={key} {...linkProps} label={t('trace.unknownInput')} detail={block.provider_type} value={block.value} />;
}

function outputEvent(block: ModelOutputBlock, key: string, t: Translate, link: TraceEventLink | undefined, highlightedAnchorId: string | null, onNavigate: (anchorId: string) => void) {
  const linkProps = eventLinkProps(link, t, highlightedAnchorId, onNavigate);
  if (block.type === 'text') return <Event key={key} {...linkProps} label={t('trace.assistantText')} text={block.text} defaultOpen />;
  if (block.type === 'reasoning') return <Event key={key} {...linkProps} label={t('trace.thinking')} text={block.text} />;
  if (block.type === 'tool_call') return block.input_raw !== undefined
    ? <Event key={key} {...linkProps} label={t('trace.toolCall')} emphasis={block.name} detail={`${block.id ? `${block.id} · ` : ''}${t('trace.invalidJson')}`} text={block.input_raw} />
    : <Event key={key} {...linkProps} label={t('trace.toolCall')} emphasis={block.name} detail={block.id} value={block.input} />;
  return <Event key={key} {...linkProps} label={t('trace.unknownOutput')} detail={block.provider_type} value={block.value} />;
}

function visibleOutput(block: ModelOutputBlock): boolean {
  return block.type !== 'unknown' || block.provider_type !== 'openai_delta_fields';
}

function statusTone(status?: number | null) {
  if (status === undefined || status === null) return 'neutral';
  return status >= 200 && status < 300 ? 'good' : 'bad';
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

function Call({ call, callIndex, selected, selectCapture, links, highlightedAnchorId, onNavigate }: { call: TraceCall; callIndex: number; selected: boolean; selectCapture: (id: string) => void; links: TraceLinkIndex; highlightedAnchorId: string | null; onNavigate: (anchorId: string) => void }) {
  const { t, locale } = useI18n();
  const usage = aggregateUsage([call.output?.usage]);
  const hasUsage = Object.values(usage).some((value) => value !== null);
  return (
    <article className="trace-call" data-selected={selected || undefined}>
      <button className="trace-call-header ui-interactive" type="button" onClick={() => selectCapture(call.capture_id)} aria-label={t('trace.selectRequest', { id: call.capture_id })}>
        <span className="trace-call-index">{call.capture_id.slice(0, 8)}</span>
        <span className="trace-call-model">{call.model ?? t('common.unknownModel')}</span>
        <span className="trace-call-host" title={call.upstream_host}>{call.upstream_host ?? t('common.unknownUpstream')}</span>
        <time dateTime={call.timestamp}>{new Date(call.timestamp).toLocaleTimeString(locale)}</time>
        <b className={`trace-http trace-http--${statusTone(call.response_status)}`}>HTTP {call.response_status ?? '—'}</b>
      </button>
      {hasUsage && <UsageMetrics usage={usage} compact />}
      <div className="trace-events">
        {call.input_relation === 'rewritten' && <div className="trace-notice">{t('trace.inputRewritten')}</div>}
        {call.input_delta.flatMap((message, messageIndex) => message.content.map((block, blockIndex) => {
          const key = eventKey(callIndex, 'input', messageIndex, blockIndex);
          return conversationEvent(block, message.role, key, t, links.get(key), highlightedAnchorId, onNavigate);
        }))}
        {call.output?.error && <div className="trace-provider-error"><strong>{call.output.error.type ?? t('trace.providerError')}</strong><span>{call.output.error.message}</span></div>}
        {call.output?.content.filter(visibleOutput).map((block, blockIndex) => {
          const key = eventKey(callIndex, 'output', 0, blockIndex);
          return outputEvent(block, key, t, links.get(key), highlightedAnchorId, onNavigate);
        })}
        {!call.input_delta.length && !call.output?.content.filter(visibleOutput).length && !call.output?.error && <div className="trace-empty-event">{t('trace.noEvents')}</div>}
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
  selectCapture: (id: string) => void;
}) {
  const { t } = useI18n();
  const linkIndex = useMemo(() => buildTraceLinkIndex(trace?.calls ?? []), [trace]);
  const [highlightedAnchorId, setHighlightedAnchorId] = useState<string | null>(null);
  const highlightTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
  }, []);
  const navigateToToolCall = useCallback((anchorId: string) => {
    const target = document.getElementById(anchorId);
    if (!target) return;
    target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    setHighlightedAnchorId(anchorId);
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightedAnchorId(null), 1600);
  }, []);
  if (loading) return <div className="detail-message"><span className="spinner" />{t('trace.loading')}</div>;
  if (error) return <div className="detail-message detail-message--error"><strong>{t('trace.loadFailed')}</strong><span>{error}</span><Button onClick={onRetry}>{t('common.tryAgain')}</Button></div>;
  if (!trace) return null;
  const usage = aggregateUsage(trace.calls.map((call) => call.output?.usage));
  return (
    <div className="trace-panel">
      <div className="trace-overview">
        <header className="trace-summary">
          <div><span>{t('tab.trace')}</span><code title={trace.id}>{trace.id}</code></div>
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
              return <Call key={call.capture_id} call={call} callIndex={callIndex} selected={call.capture_id === trace.selected_capture_id} selectCapture={selectCapture} links={linkIndex} highlightedAnchorId={highlightedAnchorId} onNavigate={navigateToToolCall} />;
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
