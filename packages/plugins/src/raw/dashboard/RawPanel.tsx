import { ScrollArea } from '@base-ui/react/scroll-area';
import type { ReactNode } from 'react';
import { JsonView } from 'react-json-view-lite';

export type RawHeaders = Record<string, string | string[] | undefined>;
export type RawCapture = {
  request: { method: string; url: string; headers: RawHeaders; body: string } | null;
  response: { status: number | null; headers: RawHeaders; body: string } | null;
};

const jsonStyles = {
  container: 'json-tree', basicChildStyle: 'json-child', childFieldsContainer: 'json-children',
  label: 'json-label', clickableLabel: 'json-label json-clickable', nullValue: 'json-null',
  undefinedValue: 'json-null', stringValue: 'json-string', booleanValue: 'json-boolean',
  numberValue: 'json-number', otherValue: 'json-other', punctuation: 'json-punctuation',
  collapseIcon: 'json-expander json-expander--open', expandIcon: 'json-expander json-expander--closed',
  collapsedContent: 'json-collapsed', quotesForFieldNames: true, stringifyStringValues: true,
  ariaLables: { collapseJson: 'Collapse JSON node', expandJson: 'Expand JSON node' },
};

const expandAllNodes = () => true;

export function parseJsonObject(body: string): object | unknown[] | null {
  if (!body.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed !== null && typeof parsed === 'object' ? parsed as object | unknown[] : null;
  } catch { return null; }
}

function httpStatusTone(status?: number | null): 'good' | 'bad' | 'neutral' {
  if (status === undefined || status === null) return 'neutral';
  return status >= 200 && status <= 299 ? 'good' : 'bad';
}

function Headers({ headers }: { headers: RawHeaders }) {
  const entries = Object.entries(headers ?? {}).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) return <span className="raw-empty-inline">(no headers)</span>;
  return <dl className="raw-headers">{entries.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{Array.isArray(value) ? value.join('\n') : value ?? ''}</dd></div>)}</dl>;
}

function Body({ body, label }: { body: string; label: string }) {
  const json = parseJsonObject(body);
  if (!body) return <pre className="raw-text raw-text--empty">(empty body)</pre>;
  if (json) return <JsonView data={json} style={jsonStyles} shouldExpandNode={expandAllNodes} clickToExpandNode aria-label={`${label} JSON body`} />;
  return <pre className="raw-text">{body}</pre>;
}

function RawSection({ kind, meta, headers, body }: { kind: 'Request' | 'Response'; meta: ReactNode; headers: RawHeaders; body: string }) {
  return (
    <section className="raw-section" aria-label={kind}>
      <header className="raw-section-header"><strong>{kind}</strong><span>{meta}</span></header>
      <ScrollArea.Root className="raw-scroll">
        <ScrollArea.Viewport className="scroll-viewport">
          <ScrollArea.Content className="raw-content">
            <div className="raw-block"><span className="raw-block-label">Headers</span><Headers headers={headers} /></div>
            <div className="raw-block"><span className="raw-block-label">Body</span><Body body={body} label={kind} /></div>
          </ScrollArea.Content>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className="scrollbar"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
        <ScrollArea.Scrollbar className="scrollbar scrollbar--horizontal" orientation="horizontal"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
        <ScrollArea.Corner className="scrollbar-corner" />
      </ScrollArea.Root>
    </section>
  );
}

export function RawPanel({ raw, loading, error, onRetry }: { raw: RawCapture | null; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <div className="detail-message"><span className="spinner" />Loading raw data…</div>;
  if (error) return <div className="detail-message detail-message--error"><strong>Couldn’t load raw data</strong><span>{error}</span><button onClick={onRetry}>Try again</button></div>;
  if (!raw) return null;
  return (
    <div className="raw-panel">
      {raw.request
        ? <RawSection kind="Request" meta={<><b>{raw.request.method}</b><code>{raw.request.url}</code></>} headers={raw.request.headers} body={raw.request.body} />
        : <section className="raw-section raw-unavailable" aria-label="Request"><strong>Request</strong><span>Raw request data is unavailable for this capture.</span></section>}
      {raw.response
        ? <RawSection kind="Response" meta={<b className={`http-status http-status--${httpStatusTone(raw.response.status)}`}>{raw.response.status ?? 'Unknown status'}</b>} headers={raw.response.headers} body={raw.response.body} />
        : <section className="raw-section raw-unavailable" aria-label="Response"><strong>Response</strong><span>Raw response data is unavailable for this capture.</span></section>}
    </div>
  );
}
