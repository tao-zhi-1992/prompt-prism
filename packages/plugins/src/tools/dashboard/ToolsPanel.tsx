import { Collapsible } from '@base-ui/react/collapsible';
import { ScrollArea } from '@base-ui/react/scroll-area';
import { JsonView } from 'react-json-view-lite';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { JsonValue } from '../../contracts/dashboard.js';
import { useI18n } from '../../i18n/index.js';
import { Button } from '@prompt-prism/ui';

export interface ToolsData {
  id: string;
  tools: JsonValue[];
  used_tools: ToolUsage[];
}

export interface ToolUsage {
  name: string;
  calls: number;
  invocations: ToolUsageInvocation[];
}

export interface ToolUsageInvocation {
  tool_call_id: string | null;
  index: number;
  input: JsonValue | null;
  input_raw?: string;
}

type JsonObject = { [key: string]: JsonValue | undefined };
type NormalizedTool = { name: string | null; description: string | null; schema?: JsonValue; raw: JsonValue; known: boolean };
type ToolParameter = { name: string; type: string; required: boolean; description: string | null };

const jsonStyles = {
  container: 'tools-json-tree', basicChildStyle: 'tools-json-child', childFieldsContainer: 'tools-json-children',
  label: 'tools-json-label', clickableLabel: 'tools-json-label tools-json-clickable', nullValue: 'tools-json-null',
  undefinedValue: 'tools-json-null', stringValue: 'tools-json-string', booleanValue: 'tools-json-boolean',
  numberValue: 'tools-json-number', otherValue: 'tools-json-other', punctuation: 'tools-json-punctuation',
  collapseIcon: 'tools-json-expander tools-json-expander--open', expandIcon: 'tools-json-expander tools-json-expander--closed',
  collapsedContent: 'tools-json-collapsed', quotesForFieldNames: true, stringifyStringValues: true,
};

const expandAllNodes = () => true;

function asObject(value: JsonValue | undefined): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeTool(raw: JsonValue): NormalizedTool {
  const value = asObject(raw);
  const fn = asObject(value?.function);
  const name = stringValue(fn?.name) ?? stringValue(value?.name);
  const description = stringValue(fn?.description) ?? stringValue(value?.description);
  const schema = fn?.parameters ?? value?.input_schema ?? value?.parameters;
  return { name, description, schema, raw, known: Boolean(name || description || schema !== undefined) };
}

function schemaType(value: JsonValue | undefined): string {
  const object = asObject(value);
  const type = stringValue(object?.type);
  if (type) return type;
  if (Array.isArray(object?.enum)) return 'enum';
  if (Array.isArray(object?.oneOf)) return 'union';
  return 'unknown';
}

function parametersFromSchema(schema: JsonValue | undefined): ToolParameter[] {
  const schemaObject = asObject(schema);
  const properties = asObject(schemaObject?.properties);
  if (!properties) return [];
  const required = new Set(Array.isArray(schemaObject?.required)
    ? schemaObject.required.filter((value): value is string => typeof value === 'string')
    : []);
  return Object.entries(properties).map(([name, value]) => ({
    name,
    type: schemaType(value),
    required: required.has(name),
    description: stringValue(asObject(value)?.description),
  }));
}

function JsonValueView({ value, label }: { value: JsonValue; label: string }) {
  const { t } = useI18n();
  if (value !== null && typeof value === 'object') {
    return <JsonView data={value} style={{ ...jsonStyles, ariaLables: { collapseJson: t('json.collapse'), expandJson: t('json.expand') } }} shouldExpandNode={expandAllNodes} clickToExpandNode aria-label={label} />;
  }
  return <pre className="tools-json-value" aria-label={label}>{JSON.stringify(value, null, 2)}</pre>;
}

function ParameterList({ schema }: { schema?: JsonValue }) {
  const { t } = useI18n();
  const parameters = parametersFromSchema(schema);
  if (schema === undefined || parameters.length === 0) return <span className="tools-card-empty">{t('tools.noParameters')}</span>;
  return (
    <div className="tools-parameters" role="list" aria-label={t('tools.parameters')}>
      {parameters.map((parameter) => (
        <div className="tools-parameter" role="listitem" key={parameter.name}>
          <code>{parameter.name}</code>
          <span className="tools-parameter-type">{parameter.type}</span>
          <span className={`tools-parameter-required${parameter.required ? ' tools-parameter-required--yes' : ''}`}>{parameter.required ? t('tools.required') : t('tools.optional')}</span>
          {parameter.description && <span className="tools-parameter-description">{parameter.description}</span>}
        </div>
      ))}
    </div>
  );
}

function ToolCard({ tool, index }: { tool: NormalizedTool; index: number }) {
  const { t } = useI18n();
  const title = tool.name ?? t('tools.unnamed');
  const value = tool.known ? tool.schema : tool.raw;
  return (
    <Collapsible.Root className="tools-card" defaultOpen={false}>
      <Collapsible.Trigger className="tools-card-header detail-sticky-header ui-interactive">
        <strong title={tool.name ?? undefined}>{title}</strong>
        <span className="tools-chevron" aria-hidden="true" />
      </Collapsible.Trigger>
      <Collapsible.Panel className="tools-card-panel">
        <div className="tools-card-body">
          <section className="tools-card-section">
            <span className="tools-card-label">{t('tools.description')}</span>
            <p className="tools-card-description">{tool.description ?? t('tools.noDescription')}</p>
          </section>
          <section className="tools-card-section">
            <span className="tools-card-label">{tool.known ? t('tools.parameters') : t('tools.raw')}</span>
            {tool.known
              ? <ParameterList schema={tool.schema} />
              : <JsonValueView value={value ?? null} label={t('tools.schemaLabel', { index: index + 1 })} />}
          </section>
          {tool.known && tool.schema !== undefined && <section className="tools-card-section">
            <span className="tools-card-label">{t('tools.schema')}</span>
            <details className="tools-schema">
              <summary>{t('tools.schema')}</summary>
              <JsonValueView value={tool.schema} label={t('tools.schemaLabel', { index: index + 1 })} />
            </details>
          </section>}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function toolTraceHref(captureId: string, invocation: ToolUsageInvocation): string {
  const url = new URL(window.location.href);
  url.searchParams.set('capture', captureId);
  url.searchParams.set('tab', 'trace');
  if (invocation.tool_call_id) {
    url.searchParams.set('tool_call_id', invocation.tool_call_id);
    url.searchParams.delete('tool_call_index');
  } else {
    url.searchParams.delete('tool_call_id');
    url.searchParams.set('tool_call_index', String(invocation.index));
  }
  url.hash = '';
  return `${url.pathname}${url.search}`;
}

function ToolInvocationLink({ captureId, invocation, position, selectCapture, label, className = 'tools-used-call' }: { captureId: string; invocation: ToolUsageInvocation; position: number; selectCapture?: (id: string, tab?: string) => void; label?: string; className?: string }) {
  const { t } = useI18n();
  const href = toolTraceHref(captureId, invocation);
  const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!selectCapture || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.history.replaceState(null, '', href);
    selectCapture(captureId, 'trace');
  };
  return <a className={`${className} ui-interactive`} href={href} onClick={handleClick} title={invocation.tool_call_id ?? undefined}>{label ?? `${t('tools.call', { index: position + 1 })} →`}</a>;
}

function UsedToolStat({ captureId, tool, selectCapture }: { captureId: string; tool: ToolUsage; selectCapture?: (id: string, tab?: string) => void }) {
  const invocations = tool.invocations;
  if (invocations.length <= 1) {
    const invocation = invocations[0];
    if (!invocation) return <code className="tools-used-tool">{tool.name} × {tool.calls}</code>;
    return <span className="tools-used-group"><ToolInvocationLink className="tools-used-tool" captureId={captureId} invocation={invocation} position={0} selectCapture={selectCapture} label={`${tool.name} × ${tool.calls}`} /></span>;
  }
  return (
    <details className="tools-used-group">
      <summary className="tools-used-tool">{tool.name} × {tool.calls}</summary>
      <div className="tools-used-call-list" aria-label={tool.name}>
        {invocations.map((invocation, index) => <ToolInvocationLink key={`${invocation.tool_call_id ?? 'call'}-${invocation.index}`} captureId={captureId} invocation={invocation} position={index} selectCapture={selectCapture} />)}
      </div>
    </details>
  );
}

export function ToolsPanel({ data, loading, error, onRetry, selectCapture }: { data: ToolsData | null; loading: boolean; error: string | null; onRetry: () => void; selectCapture?: (id: string, tab?: string) => void }) {
  const { t } = useI18n();
  if (loading) return <div className="detail-message"><span className="spinner" />{t('tools.loading')}</div>;
  if (error) return <div className="detail-message detail-message--error"><strong>{t('tools.loadFailed')}</strong><span>{error}</span><Button onClick={onRetry}>{t('common.tryAgain')}</Button></div>;
  if (!data) return null;
  return (
    <div className="tools-panel">
      <header className="tools-summary">
        <div className="tools-summary-stat">
          <span>{t('tools.total')}</span>
          <strong>{data.tools.length}</strong>
        </div>
        <div className="tools-summary-stat tools-summary-stat--called">
          <span>{t('tools.called')}</span>
          <div className="tools-used-list">
            {data.used_tools.length > 0
              ? data.used_tools.map((tool) => <UsedToolStat captureId={data.id} tool={tool} selectCapture={selectCapture} key={tool.name} />)
              : <span className="tools-summary-empty">{t('tools.noCalls')}</span>}
          </div>
        </div>
      </header>
      <ScrollArea.Root className="tools-scroll">
        <ScrollArea.Viewport className="scroll-viewport">
          <ScrollArea.Content className="tools-content">
            {data.tools.length > 0
              ? data.tools.map((tool, index) => <ToolCard tool={normalizeTool(tool)} index={index} key={index} />)
              : <div className="tools-empty">{t('tools.notSet')}</div>}
          </ScrollArea.Content>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className="scrollbar"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
        <ScrollArea.Scrollbar className="scrollbar scrollbar--horizontal" orientation="horizontal"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
        <ScrollArea.Corner className="scrollbar-corner" />
      </ScrollArea.Root>
    </div>
  );
}
