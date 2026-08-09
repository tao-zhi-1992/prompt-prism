import { Collapsible } from '@base-ui/react/collapsible';
import { ScrollArea } from '@base-ui/react/scroll-area';
import { Tooltip } from '@base-ui/react/tooltip';
import { JsonView } from 'react-json-view-lite';
import type {
  ConversationContentBlock,
  ConversationMessage,
  JsonValue,
  ModelOutputBlock,
  ModelOutputSnapshot,
  Usage,
} from '../../contracts/dashboard.js';

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
  ariaLables: { collapseJson: 'Collapse JSON node', expandJson: 'Expand JSON node' },
};

function JsonBody({ value }: { value: JsonValue | null }) {
  if (value !== null && typeof value === 'object') return <JsonView data={value} style={jsonStyles} shouldExpandNode={() => true} clickToExpandNode />;
  return <pre className="trace-code">{value === null ? '(empty)' : JSON.stringify(value, null, 2)}</pre>;
}

function Toggle({ label, detail }: { label: string; detail?: string | null }) {
  return <Collapsible.Trigger className="trace-event-toggle"><strong>{label}</strong>{detail && <code>{detail}</code>}<span className="trace-chevron" aria-hidden="true" /></Collapsible.Trigger>;
}

function Event({ label, detail, text, value, defaultOpen = false, tone }: {
  label: string;
  detail?: string | null;
  text?: string;
  value?: JsonValue | null;
  defaultOpen?: boolean;
  tone?: 'error';
}) {
  return (
    <Collapsible.Root className={`trace-event${tone ? ` trace-event--${tone}` : ''}`} defaultOpen={defaultOpen}>
      <Toggle label={label} detail={detail} />
      <Collapsible.Panel className="trace-event-panel">
        {text !== undefined ? <pre className="trace-text">{text || '(empty)'}</pre> : <JsonBody value={value ?? null} />}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function conversationEvent(block: ConversationContentBlock, role: string, index: number) {
  if (block.type === 'text') return <Event key={index} label={role === 'user' ? 'User' : `${role} text`} text={block.text} defaultOpen />;
  if (block.type === 'reasoning') return <Event key={index} label="Thinking" text={block.text} />;
  if (block.type === 'tool_call') return <Event key={index} label="Tool call" detail={`${block.name}${block.id ? ` · ${block.id}` : ''}`} value={block.input} />;
  if (block.type === 'tool_result') return <Event key={index} label="Tool result" detail={block.tool_call_id} value={block.content} tone={block.is_error ? 'error' : undefined} />;
  return <Event key={index} label="Unknown input" detail={block.provider_type} value={block.value} />;
}

function outputEvent(block: ModelOutputBlock, index: number) {
  if (block.type === 'text') return <Event key={index} label="Assistant text" text={block.text} defaultOpen />;
  if (block.type === 'reasoning') return <Event key={index} label="Thinking" text={block.text} />;
  if (block.type === 'tool_call') return block.input_raw
    ? <Event key={index} label="Tool call" detail={`${block.name}${block.id ? ` · ${block.id}` : ''} · invalid JSON`} text={block.input_raw} />
    : <Event key={index} label="Tool call" detail={`${block.name}${block.id ? ` · ${block.id}` : ''}`} value={block.input} />;
  return <Event key={index} label="Unknown output" detail={block.provider_type} value={block.value} />;
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

const numberFormat = new Intl.NumberFormat();

function tokenValue(value: number | null): string { return value === null ? '—' : numberFormat.format(value); }
function rateValue(value: number | null): string { return value === null ? '—' : `${Math.round(value * 100)}%`; }

function UsageMetrics({ usage, compact = false }: { usage: UsageSummary; compact?: boolean }) {
  const metrics = [
    { label: compact ? 'Input' : 'Input total', value: tokenValue(usage.input), title: 'Uncached input + cache read + cache write tokens' },
    { label: 'Output', value: tokenValue(usage.output) },
    { label: 'Cache read', value: tokenValue(usage.cacheRead) },
    { label: 'Cache write', value: tokenValue(usage.cacheWrite) },
    { label: 'Cache hit', value: rateValue(usage.cacheHitRate) },
  ];
  return <dl className={compact ? 'trace-call-usage' : 'trace-usage'}>{metrics.map((metric) => <div key={metric.label}><dt title={metric.title}>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>;
}

function Call({ call, selected, selectCapture }: { call: TraceCall; selected: boolean; selectCapture: (id: string) => void }) {
  const usage = aggregateUsage([call.output?.usage]);
  const hasUsage = Object.values(usage).some((value) => value !== null);
  return (
    <article className="trace-call" data-selected={selected || undefined}>
      <button className="trace-call-header" type="button" onClick={() => selectCapture(call.capture_id)} aria-label={`Select request ${call.capture_id}`}>
        <span className="trace-call-index">{call.capture_id.slice(0, 8)}</span>
        <span className="trace-call-model">{call.model ?? 'Unknown model'}</span>
        <span className="trace-call-host" title={call.upstream_host}>{call.upstream_host ?? 'Unknown upstream'}</span>
        <time dateTime={call.timestamp}>{new Date(call.timestamp).toLocaleTimeString()}</time>
        <b className={`trace-http trace-http--${statusTone(call.response_status)}`}>HTTP {call.response_status ?? '—'}</b>
      </button>
      {hasUsage && <UsageMetrics usage={usage} compact />}
      <div className="trace-events">
        {call.input_relation === 'rewritten' && <div className="trace-notice">Input history was rewritten; showing the complete current input.</div>}
        {call.input_delta.flatMap((message, messageIndex) => message.content.map((block, blockIndex) => conversationEvent(block, message.role, messageIndex * 1000 + blockIndex)))}
        {call.output?.error && <div className="trace-provider-error"><strong>{call.output.error.type ?? 'Provider error'}</strong><span>{call.output.error.message}</span></div>}
        {call.output?.content.map(outputEvent)}
        {!call.input_delta.length && !call.output?.content.length && !call.output?.error && <div className="trace-empty-event">No recognizable events for this request.</div>}
      </div>
    </article>
  );
}

function TraceSource({ source }: { source: TraceResult['source'] }) {
  if (source === 'explicit') return <div><span>Source</span><b>Explicit</b></div>;
  return (
    <div>
      <span>Source</span>
      <div className="trace-source-value">
        <b>Inferred</b>
        <Tooltip.Root>
          <Tooltip.Trigger className="trace-info-trigger" aria-label="About inferred traces">?</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner side="bottom" align="start" className="trace-tooltip-positioner">
              <Tooltip.Popup className="trace-tooltip">Matched from related request history. For reliable tracking, send <code>x-prompt-prism-trace-id</code> with the same value on every related model request.</Tooltip.Popup>
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
  if (loading) return <div className="detail-message"><span className="spinner" />Loading trace…</div>;
  if (error) return <div className="detail-message detail-message--error"><strong>Couldn’t load trace</strong><span>{error}</span><button onClick={onRetry}>Try again</button></div>;
  if (!trace) return null;
  const usage = aggregateUsage(trace.calls.map((call) => call.output?.usage));
  return (
    <div className="trace-panel">
      <div className="trace-overview">
        <header className="trace-summary">
          <div><span>Trace</span><code title={trace.id}>{trace.id}</code></div>
          <TraceSource source={trace.source} />
          <div><span>Calls</span><b>{trace.calls.length}</b></div>
        </header>
        <UsageMetrics usage={usage} />
        {(trace.truncated || refreshError) && (
          <div className="trace-notices">
            <div className={`trace-warning${refreshError ? ' trace-warning--error' : ''}`}>{refreshError ? `Refresh failed: ${refreshError}` : 'The beginning of this trace is no longer available.'}</div>
          </div>
        )}
      </div>
      <ScrollArea.Root className="trace-scroll">
        <ScrollArea.Viewport className="scroll-viewport">
          <ScrollArea.Content className="trace-content">
            {[...trace.calls].reverse().map((call) => <Call key={call.capture_id} call={call} selected={call.capture_id === trace.selected_capture_id} selectCapture={selectCapture} />)}
            {!trace.calls.length && <div className="trace-empty-event">No trace calls are available.</div>}
          </ScrollArea.Content>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className="scrollbar"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
        <ScrollArea.Scrollbar className="scrollbar scrollbar--horizontal" orientation="horizontal"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
        <ScrollArea.Corner className="scrollbar-corner" />
      </ScrollArea.Root>
    </div>
  );
}
