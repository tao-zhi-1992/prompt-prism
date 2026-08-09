import { Collapsible } from '@base-ui/react/collapsible';
import { ScrollArea } from '@base-ui/react/scroll-area';
import { JsonView } from 'react-json-view-lite';
import type {
  ConversationContentBlock,
  ConversationMessage,
  JsonValue,
  ModelOutputBlock,
  ModelOutputSnapshot,
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

function Call({ call, selected, selectCapture }: { call: TraceCall; selected: boolean; selectCapture: (id: string) => void }) {
  return (
    <article className="trace-call" data-selected={selected || undefined}>
      <button className="trace-call-header" type="button" onClick={() => selectCapture(call.capture_id)} aria-label={`Select request ${call.capture_id}`}>
        <span className="trace-call-index">{call.capture_id.slice(0, 8)}</span>
        <span className="trace-call-model">{call.model ?? 'Unknown model'}</span>
        <span className="trace-call-host" title={call.upstream_host}>{call.upstream_host ?? 'Unknown upstream'}</span>
        <time dateTime={call.timestamp}>{new Date(call.timestamp).toLocaleTimeString()}</time>
        <b className={`trace-http trace-http--${statusTone(call.response_status)}`}>HTTP {call.response_status ?? '—'}</b>
      </button>
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
  return (
    <div className="trace-panel">
      <header className="trace-summary">
        <div><span>Trace</span><code title={trace.id}>{trace.id}</code></div>
        <div><span>Source</span><b>{trace.source === 'explicit' ? 'Explicit' : 'Inferred'}</b></div>
        <div><span>Calls · newest first</span><b>{trace.calls.length}</b></div>
      </header>
      {(trace.truncated || refreshError) && <div className={`trace-warning${refreshError ? ' trace-warning--error' : ''}`}>{refreshError ? `Refresh failed: ${refreshError}` : 'The beginning of this trace is no longer available.'}</div>}
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
