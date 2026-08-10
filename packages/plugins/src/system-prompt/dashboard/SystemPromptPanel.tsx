import { ScrollArea } from '@base-ui/react/scroll-area';
import { JsonView } from 'react-json-view-lite';
import { useI18n } from '../../i18n/index.js';
import type { JsonValue } from '../../contracts/dashboard.js';
import { Button } from '@prompt-prism/ui';

export interface SystemPromptData {
  id: string;
  system: JsonValue | null;
}

const jsonStyles = {
  container: 'json-tree', basicChildStyle: 'json-child', childFieldsContainer: 'json-children',
  label: 'json-label', clickableLabel: 'json-label json-clickable', nullValue: 'json-null',
  undefinedValue: 'json-null', stringValue: 'json-string', booleanValue: 'json-boolean',
  numberValue: 'json-number', otherValue: 'json-other', punctuation: 'json-punctuation',
  collapseIcon: 'json-expander json-expander--open', expandIcon: 'json-expander json-expander--closed',
  collapsedContent: 'json-collapsed', quotesForFieldNames: true, stringifyStringValues: true,
};

const expandAllNodes = () => true;

interface SystemMessage {
  role: string;
  content?: JsonValue;
}

function isSystemMessage(value: JsonValue): value is { role: string; content: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && typeof (value as { role?: unknown }).role === 'string';
}

function textBlock(value: JsonValue): string | null {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const block = value as { type?: unknown; text?: unknown };
    if (block.type === 'text' && typeof block.text === 'string') return block.text;
  }
  return null;
}

function SystemMessageView({ message }: { message: SystemMessage }) {
  const { t } = useI18n();
  const content = message.content;
  return (
    <div className="system-prompt-message">
      <span className="system-prompt-message-role">{message.role}</span>
      {content === undefined || content === null
        ? <span className="system-prompt-notice">{t('common.empty')}</span>
        : <SystemContent value={content} />}
    </div>
  );
}

function SystemBlock({ value }: { value: JsonValue }) {
  const { t } = useI18n();
  if (isSystemMessage(value)) return <SystemMessageView message={value} />;
  const text = textBlock(value);
  if (text !== null) return <pre className="system-prompt-text">{text}</pre>;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return <pre className="system-prompt-text">{String(value)}</pre>;
  }
  return (
    <JsonView
      data={value}
      style={{ ...jsonStyles, ariaLables: { collapseJson: t('json.collapse'), expandJson: t('json.expand') } }}
      shouldExpandNode={expandAllNodes}
      clickToExpandNode
    />
  );
}

function SystemContent({ value }: { value: JsonValue }) {
  if (typeof value === 'string') return <pre className="system-prompt-text">{value}</pre>;
  if (Array.isArray(value)) {
    return (
      <div className="system-prompt-blocks">
        {value.map((item, index) => <SystemBlock value={item} key={index} />)}
      </div>
    );
  }
  return <SystemBlock value={value} />;
}

export function SystemPromptPanel({ data, loading, error, onRetry }: { data: SystemPromptData | null; loading: boolean; error: string | null; onRetry: () => void }) {
  const { t } = useI18n();
  if (loading) return <div className="detail-message"><span className="spinner" />{t('system-prompt.loading')}</div>;
  if (error) return <div className="detail-message detail-message--error"><strong>{t('system-prompt.loadFailed')}</strong><span>{error}</span><Button onClick={onRetry}>{t('common.tryAgain')}</Button></div>;
  if (!data) return null;
  return (
    <div className="system-prompt-panel">
      <div className="system-prompt-header"><strong>{t('system-prompt.content')}</strong></div>
      <ScrollArea.Root className="system-prompt-scroll">
        <ScrollArea.Viewport className="scroll-viewport">
          <ScrollArea.Content className="system-prompt-content">
            {data.system === null
              ? <div className="system-prompt-notice">{t('system-prompt.notSet')}</div>
              : <SystemContent value={data.system} />}
          </ScrollArea.Content>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className="scrollbar"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
        <ScrollArea.Scrollbar className="scrollbar scrollbar--horizontal" orientation="horizontal"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
        <ScrollArea.Corner className="scrollbar-corner" />
      </ScrollArea.Root>
    </div>
  );
}
