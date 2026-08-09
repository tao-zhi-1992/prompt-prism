import { Collapsible } from '@base-ui/react/collapsible';
import { ScrollArea } from '@base-ui/react/scroll-area';
import { JsonView } from 'react-json-view-lite';
import type {
  JsonValue,
  ModelOutputBlock,
  ModelOutputSnapshot,
  ToolCallOutputBlock,
  UnknownOutputBlock,
  Usage,
} from '../../contracts/dashboard.js';

export type OutputCapture = { output: ModelOutputSnapshot | null };

const jsonStyles = {
  container: 'output-json-tree', basicChildStyle: 'output-json-child', childFieldsContainer: 'output-json-children',
  label: 'output-json-label', clickableLabel: 'output-json-label output-json-clickable', nullValue: 'output-json-null',
  undefinedValue: 'output-json-null', stringValue: 'output-json-string', booleanValue: 'output-json-boolean',
  numberValue: 'output-json-number', otherValue: 'output-json-other', punctuation: 'output-json-punctuation',
  collapseIcon: 'output-json-expander output-json-expander--open', expandIcon: 'output-json-expander output-json-expander--closed',
  collapsedContent: 'output-json-collapsed', quotesForFieldNames: true, stringifyStringValues: true,
  ariaLables: { collapseJson: 'Collapse JSON node', expandJson: 'Expand JSON node' },
};

const expandAllNodes = () => true;

function isContainer(value: JsonValue | null): value is { [key: string]: JsonValue } | JsonValue[] {
  return value !== null && typeof value === 'object';
}

function JsonBody({ value, label }: { value: JsonValue | null; label: string }) {
  if (isContainer(value)) return <JsonView data={value} style={jsonStyles} shouldExpandNode={expandAllNodes} clickToExpandNode aria-label={label} />;
  if (value === null) return <pre className="output-code output-code--empty">(no arguments)</pre>;
  return <pre className="output-code">{JSON.stringify(value, null, 2)}</pre>;
}

function ToggleHeader({ label, detail }: { label: string; detail?: string }) {
  return (
    <Collapsible.Trigger className="output-block-toggle">
      <strong>{label}</strong>
      {detail && <code>{detail}</code>}
      <span className="output-chevron" aria-hidden="true" />
    </Collapsible.Trigger>
  );
}

function ToolCall({ block }: { block: ToolCallOutputBlock }) {
  return (
    <section className="output-block output-tool-call">
      <header className="output-block-header">
        <strong>Tool call</strong>
        <span><b>{block.name}</b>{block.id && <code>{block.id}</code>}</span>
      </header>
      <div className="output-block-body">
        {block.input_raw
          ? <><span className="output-invalid-label">Invalid JSON arguments</span><pre className="output-code">{block.input_raw}</pre></>
          : <JsonBody value={block.input} label={`${block.name} tool arguments`} />}
      </div>
    </section>
  );
}

function Unknown({ block }: { block: UnknownOutputBlock }) {
  return (
    <Collapsible.Root className="output-block" defaultOpen={false}>
      <ToggleHeader label="Unknown block" detail={block.provider_type} />
      <Collapsible.Panel className="output-collapsible-panel">
        <div className="output-block-body"><JsonBody value={block.value} label={`${block.provider_type} provider block`} /></div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function ContentBlock({ block, index }: { block: ModelOutputBlock; index: number }) {
  if (block.type === 'text') {
    return (
      <Collapsible.Root className="output-block" defaultOpen>
        <ToggleHeader label="Text" />
        <Collapsible.Panel className="output-collapsible-panel"><pre className="output-text">{block.text}</pre></Collapsible.Panel>
      </Collapsible.Root>
    );
  }
  if (block.type === 'reasoning') {
    return (
      <Collapsible.Root className="output-block" defaultOpen>
        <ToggleHeader label="Thinking" />
        <Collapsible.Panel className="output-collapsible-panel"><pre className="output-text output-thinking">{block.text}</pre></Collapsible.Panel>
      </Collapsible.Root>
    );
  }
  if (block.type === 'tool_call') return <ToolCall block={block} />;
  return <Unknown block={block} key={`${block.provider_type}-${index}`} />;
}

const metrics: Array<{ key: keyof Usage; label: string }> = [
  { key: 'input_tokens', label: 'Input' },
  { key: 'output_tokens', label: 'Output' },
  { key: 'cache_creation_input_tokens', label: 'Cache create' },
  { key: 'cache_read_input_tokens', label: 'Cache read' },
];

function Summary({ output }: { output: ModelOutputSnapshot }) {
  return (
    <div className="output-summary">
      <div className="output-stop"><span>Stop reason</span><code>{output.stop_reason ?? '—'}</code></div>
      <dl className="output-usage">
        {metrics.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd>{output.usage[key] ?? '—'}</dd></div>)}
      </dl>
    </div>
  );
}

export function OutputPanel({ result, loading, error, onRetry }: { result: OutputCapture | null; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <div className="detail-message"><span className="spinner" />Loading output…</div>;
  if (error) return <div className="detail-message detail-message--error"><strong>Couldn’t load output</strong><span>{error}</span><button onClick={onRetry}>Try again</button></div>;
  if (!result) return null;
  if (!result.output) return <div className="detail-message"><strong>Output unavailable</strong><span>This capture has no recognizable model response. Check Raw for the original response.</span></div>;
  const output = result.output;
  const orderedContent = [...output.content.filter((block) => block.type === 'text'), ...output.content.filter((block) => block.type !== 'text')];
  return (
    <div className="output-panel">
      <Summary output={output} />
      <ScrollArea.Root className="output-scroll">
        <ScrollArea.Viewport className="scroll-viewport">
          <ScrollArea.Content className="output-content">
            {output.error && <section className="output-provider-error"><strong>{output.error.type ?? 'Provider error'}</strong><span>{output.error.message}</span></section>}
            {orderedContent.map((block, index) => <ContentBlock block={block} index={index} key={`${block.type}-${index}`} />)}
            {!output.error && output.content.length === 0 && <div className="output-empty">(no output content)</div>}
          </ScrollArea.Content>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className="scrollbar"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
        <ScrollArea.Scrollbar className="scrollbar scrollbar--horizontal" orientation="horizontal"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
        <ScrollArea.Corner className="scrollbar-corner" />
      </ScrollArea.Root>
    </div>
  );
}
