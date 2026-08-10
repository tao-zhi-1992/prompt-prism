import { ScrollArea } from '@base-ui/react/scroll-area';
import type { ReactNode } from 'react';
import { JsonView } from 'react-json-view-lite';
import { useI18n } from '../../i18n/index.js';
import { Button } from '@prompt-prism/ui';

export type RawHeaders = Record<string, string | string[] | undefined>;
export type RawCapture = {
  request: { method: string; url: string; target_url?: string; headers: RawHeaders; body: string } | null;
  response: { status: number | null; headers: RawHeaders; body: string } | null;
};

const jsonStyles = {
  container: 'json-tree', basicChildStyle: 'json-child', childFieldsContainer: 'json-children',
  label: 'json-label', clickableLabel: 'json-label json-clickable', nullValue: 'json-null',
  undefinedValue: 'json-null', stringValue: 'json-string', booleanValue: 'json-boolean',
  numberValue: 'json-number', otherValue: 'json-other', punctuation: 'json-punctuation',
  collapseIcon: 'json-expander json-expander--open', expandIcon: 'json-expander json-expander--closed',
  collapsedContent: 'json-collapsed', quotesForFieldNames: true, stringifyStringValues: true,
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
  const { t } = useI18n();
  const entries = Object.entries(headers ?? {}).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) return <span className="raw-empty-inline">{t('raw.noHeaders')}</span>;
  return <dl className="raw-headers">{entries.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{Array.isArray(value) ? value.join('\n') : value ?? ''}</dd></div>)}</dl>;
}

function Body({ body, label }: { body: string; label: string }) {
  const { t } = useI18n();
  const json = parseJsonObject(body);
  if (!body) return <pre className="raw-text raw-text--empty">{t('raw.emptyBody')}</pre>;
  if (json) return <JsonView data={json} style={{ ...jsonStyles, ariaLables: { collapseJson: t('json.collapse'), expandJson: t('json.expand') } }} shouldExpandNode={expandAllNodes} clickToExpandNode aria-label={t('raw.jsonBody', { kind: label })} />;
  return <pre className="raw-text">{body}</pre>;
}

function RawSection({ kind, meta, headers, body }: { kind: 'request' | 'response'; meta: ReactNode; headers: RawHeaders; body: string }) {
  const { t } = useI18n();
  const label = t(`raw.${kind}`);
  return (
    <section className="raw-section" aria-label={label}>
      <header className="raw-section-header"><strong>{label}</strong><span>{meta}</span></header>
      <ScrollArea.Root className="raw-scroll">
        <ScrollArea.Viewport className="scroll-viewport">
          <ScrollArea.Content className="raw-content">
            <div className="raw-block"><span className="raw-block-label">{t('raw.headers')}</span><Headers headers={headers} /></div>
            <div className="raw-block"><span className="raw-block-label">{t('raw.body')}</span><Body body={body} label={label} /></div>
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
  const { t } = useI18n();
  if (loading) return <div className="detail-message"><span className="spinner" />{t('raw.loading')}</div>;
  if (error) return <div className="detail-message detail-message--error"><strong>{t('raw.loadFailed')}</strong><span>{error}</span><Button onClick={onRetry}>{t('common.tryAgain')}</Button></div>;
  if (!raw) return null;
  return (
    <div className="raw-panel">
      {raw.request
        ? <RawSection kind="request" meta={<><b>{raw.request.method}</b><span className="raw-url"><small>{t('raw.clientUrl')}</small><code>{raw.request.url}</code></span>{raw.request.target_url && <span className="raw-url"><small>{t('raw.upstreamUrl')}</small><code>{raw.request.target_url}</code></span>}</>} headers={raw.request.headers} body={raw.request.body} />
        : <section className="raw-section raw-unavailable" aria-label={t('raw.request')}><strong>{t('raw.request')}</strong><span>{t('raw.requestUnavailable')}</span></section>}
      {raw.response
        ? <RawSection kind="response" meta={<b className={`http-status http-status--${httpStatusTone(raw.response.status)}`}>{raw.response.status ?? t('raw.unknownStatus')}</b>} headers={raw.response.headers} body={raw.response.body} />
        : <section className="raw-section raw-unavailable" aria-label={t('raw.response')}><strong>{t('raw.response')}</strong><span>{t('raw.responseUnavailable')}</span></section>}
    </div>
  );
}
