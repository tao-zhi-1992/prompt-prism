import { Collapsible } from '@base-ui/react/collapsible';
import { ScrollArea } from '@base-ui/react/scroll-area';
import type {
  JsonValue,
  ModelOutputBlock,
  ModelOutputSnapshot,
  ToolCallOutputBlock,
  UnknownOutputBlock,
  Usage,
} from '@prompt-prism/dashboard-kit';
import { useI18n, type TranslationKey } from '@prompt-prism/dashboard-kit';
import { Button } from '@prompt-prism/ui';
import { StructuredContent } from '../../content/StructuredContent.js';

export type OutputCapture = { output: ModelOutputSnapshot | null };

function JsonBody({ value, label }: { value: JsonValue | null; label: string }) {
  const { t } = useI18n();
  return <StructuredContent value={value} mode="json" ariaLabel={label} emptyFallback={t('output.noArguments')} />;
}

function ToggleHeader({ label, detail }: { label: string; detail?: string }) {
  return (
    <Collapsible.Trigger className="output-block-toggle ui-interactive">
      <strong>{label}</strong>
      {detail && <code>{detail}</code>}
      <span className="output-chevron" aria-hidden="true" />
    </Collapsible.Trigger>
  );
}

function ToolCall({ block }: { block: ToolCallOutputBlock }) {
  const { t } = useI18n();
  return (
    <section className="output-block output-tool-call">
      <header className="output-block-header">
        <div className="output-tool-title"><strong>{t('output.toolCall')}</strong><b className="output-tool-name" title={block.name}>{block.name}</b></div>
        {block.id && <code className="output-tool-id">{block.id}</code>}
      </header>
      <div className="output-block-body">
        {block.input_raw !== undefined
          ? <><span className="output-invalid-label">{t('output.invalidJsonArguments')}</span><StructuredContent value={block.input_raw} mode="text" /></>
          : <JsonBody value={block.input} label={t('output.toolArguments', { name: block.name })} />}
      </div>
    </section>
  );
}

function Unknown({ block }: { block: UnknownOutputBlock }) {
  const { t } = useI18n();
  return (
    <Collapsible.Root className="output-block" defaultOpen={false}>
      <ToggleHeader label={t('output.unknownBlock')} detail={block.provider_type} />
      <Collapsible.Panel className="output-collapsible-panel">
        <div className="output-block-body"><JsonBody value={block.value} label={t('output.providerBlock', { type: block.provider_type })} /></div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function ContentBlock({ block, index }: { block: ModelOutputBlock; index: number }) {
  const { t } = useI18n();
  if (block.type === 'text') {
    return (
      <Collapsible.Root className="output-block" defaultOpen>
        <ToggleHeader label={t('output.text')} />
        <Collapsible.Panel className="output-collapsible-panel"><StructuredContent value={block.text} /></Collapsible.Panel>
      </Collapsible.Root>
    );
  }
  if (block.type === 'reasoning') {
    return (
      <Collapsible.Root className="output-block" defaultOpen>
        <ToggleHeader label={t('output.thinking')} />
        <Collapsible.Panel className="output-collapsible-panel"><StructuredContent value={block.text} className="output-thinking" /></Collapsible.Panel>
      </Collapsible.Root>
    );
  }
  if (block.type === 'tool_call') return <ToolCall block={block} />;
  return <Unknown block={block} key={`${block.provider_type}-${index}`} />;
}

const metrics: Array<{ key: keyof Usage; label: TranslationKey }> = [
  { key: 'input_tokens', label: 'usage.input' },
  { key: 'output_tokens', label: 'usage.output' },
  { key: 'cache_creation_input_tokens', label: 'usage.cacheCreate' },
  { key: 'cache_read_input_tokens', label: 'usage.cacheRead' },
];

function Summary({ output }: { output: ModelOutputSnapshot }) {
  const { t } = useI18n();
  return (
    <div className="output-summary">
      <div className="output-stop"><span>{t('output.stopReason')}</span><code>{output.stop_reason ?? '—'}</code></div>
      <dl className="output-usage">
        {metrics.map(({ key, label }) => <div key={key}><dt>{t(label)}</dt><dd>{output.usage[key] ?? '—'}</dd></div>)}
      </dl>
    </div>
  );
}

export function OutputPanel({ result, loading, error, onRetry }: { result: OutputCapture | null; loading: boolean; error: string | null; onRetry: () => void }) {
  const { t } = useI18n();
  if (loading) return <div className="detail-message"><span className="spinner" />{t('output.loading')}</div>;
  if (error) return <div className="detail-message detail-message--error"><strong>{t('output.loadFailed')}</strong><span>{error}</span><Button onClick={onRetry}>{t('common.tryAgain')}</Button></div>;
  if (!result) return null;
  if (!result.output) return <div className="detail-message"><strong>{t('output.unavailable')}</strong><span>{t('output.unavailableDescription')}</span></div>;
  const output = result.output;
  const visibleContent = output.content.filter((block) => block.type !== 'unknown' || block.visibility !== 'internal');
  const orderedContent = [...visibleContent.filter((block) => block.type === 'text'), ...visibleContent.filter((block) => block.type !== 'text')];
  return (
    <div className="output-panel">
      <Summary output={output} />
      <ScrollArea.Root className="output-scroll">
        <ScrollArea.Viewport className="scroll-viewport">
          <ScrollArea.Content className="output-content">
            {output.error && <section className="output-provider-error"><strong>{output.error.type ?? t('output.providerError')}</strong><span>{output.error.message}</span></section>}
            {orderedContent.map((block, index) => <ContentBlock block={block} index={index} key={`${block.type}-${index}`} />)}
            {!output.error && output.content.length === 0 && <div className="output-empty">{t('output.noContent')}</div>}
          </ScrollArea.Content>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className="scrollbar"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
        <ScrollArea.Scrollbar className="scrollbar scrollbar--horizontal" orientation="horizontal"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
        <ScrollArea.Corner className="scrollbar-corner" />
      </ScrollArea.Root>
    </div>
  );
}
