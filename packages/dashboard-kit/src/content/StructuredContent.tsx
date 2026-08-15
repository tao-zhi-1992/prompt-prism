import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { JsonView } from 'react-json-view-lite';
import type { JsonValue } from '@prompt-prism/contracts/model';
import { useI18n } from '../i18n/index.js';
import { Button } from '@prompt-prism/ui';
import './styles.css';

export type StructuredContentMode = 'auto' | 'json' | 'markdown' | 'code' | 'text';
export type StructuredContentKind = Exclude<StructuredContentMode, 'auto'>;

export interface StructuredContentHints {
  mode?: StructuredContentMode;
  contentType?: string;
  language?: string;
}

export interface StructuredContentProps extends StructuredContentHints {
  value: JsonValue | string | null;
  ariaLabel?: string;
  className?: string;
  allowSourceToggle?: boolean;
  emptyFallback?: ReactNode;
}

const jsonStyles = {
  container: 'structured-json-tree', basicChildStyle: 'structured-json-child', childFieldsContainer: 'structured-json-children',
  label: 'structured-json-label', clickableLabel: 'structured-json-label structured-json-clickable', nullValue: 'structured-json-null',
  undefinedValue: 'structured-json-null', stringValue: 'structured-json-string', booleanValue: 'structured-json-boolean',
  numberValue: 'structured-json-number', otherValue: 'structured-json-other', punctuation: 'structured-json-punctuation',
  collapseIcon: 'structured-json-expander structured-json-expander--open', expandIcon: 'structured-json-expander structured-json-expander--closed',
  collapsedContent: 'structured-json-collapsed', quotesForFieldNames: true, stringifyStringValues: true,
};

const expandAllNodes = () => true;

function parsedContainer(value: string): object | unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' ? parsed as object | unknown[] : null;
  } catch { return null; }
}

function contentTypeKind(contentType?: string): StructuredContentKind | null {
  const type = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (!type) return null;
  if (type === 'application/json' || type.endsWith('+json')) return 'json';
  if (type === 'text/markdown' || type === 'text/x-markdown') return 'markdown';
  if (type.startsWith('text/x-') || /(?:javascript|typescript|ecmascript|shell|python|ruby|java|css|html|xml|yaml)/.test(type)) return 'code';
  if (type.startsWith('text/')) return 'text';
  return null;
}

function isClearMarkdown(value: string): boolean {
  return /(^|\n)\s*```[\s\S]*```\s*$/m.test(value)
    || /(^|\n)\s*~~~[\s\S]*~~~\s*$/m.test(value)
    || /(^|\n)#{1,6}\s+\S/m.test(value)
    || /(^|\n)\s*(?:[-*+]\s+|\d+[.)]\s+)\S/m.test(value)
    || /(^|\n)\s*>\s+\S/m.test(value)
    || /(^|\n)\s*\|.+\|\s*\n\s*\|?\s*:?-{3,}/m.test(value)
    || /(^|\n)\s*[-*+]\s+\[[ xX]\]\s+/m.test(value);
}

function detectedCodeLanguage(value: string): string | undefined {
  if (/^\s*(?:import|export)\s.+\sfrom\s+['"]/m.test(value) || /\b(?:const|let|var)\s+\w+\s*=/.test(value) || /=>\s*[{(]?/.test(value)) return 'javascript';
  if (/^\s*(?:def|from\s+\w+\s+import|import\s+\w+)\b/m.test(value) && /:\s*(?:\n|$)/m.test(value)) return 'python';
  if (/^\s*(?:#!.*\b(?:sh|bash)|(?:set\s+-[a-z]+|[A-Z_][A-Z0-9_]*=|(?:if|for|while)\s).*)/m.test(value)) return 'bash';
  if (/^\s*(?:interface|type|enum)\s+\w+|:\s*(?:string|number|boolean)(?:\W|$)/m.test(value)) return 'typescript';
  if (/^\s*[.#]?[\w-]+(?:\s+[.#]?[\w-]+)*\s*\{[\s\S]*:[^;{}]+;/m.test(value)) return 'css';
  return undefined;
}

export function detectStructuredContent(value: JsonValue | string | null, hints: StructuredContentHints = {}): { kind: StructuredContentKind; language?: string } {
  if (hints.mode && hints.mode !== 'auto') return { kind: hints.mode, ...(hints.language ? { language: hints.language } : {}) };
  const typeKind = contentTypeKind(hints.contentType);
  if (typeKind) return { kind: typeKind, ...(hints.language ? { language: hints.language } : {}) };
  if (value !== null && typeof value === 'object') return { kind: 'json' };
  if (typeof value !== 'string') return { kind: 'text' };
  if (parsedContainer(value)) return { kind: 'json' };
  if (isClearMarkdown(value)) return { kind: 'markdown' };
  const language = hints.language ?? detectedCodeLanguage(value);
  return language ? { kind: 'code', language } : { kind: 'text' };
}

function copyText(value: JsonValue | string | null, kind?: StructuredContentKind): string {
  if (kind === 'json' && typeof value === 'string') {
    const parsed = parsedContainer(value);
    return JSON.stringify(parsed ?? value, null, 2);
  }
  if (typeof value === 'string') return value;
  if (kind === 'json' || (value !== null && typeof value === 'object')) return JSON.stringify(value, null, 2);
  return value === null ? '' : String(value);
}

export function ContentCopyButton({ value, className }: { value: string; className?: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), 1600);
    return () => window.clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setState('copied'); }
    catch { setState('failed'); }
  };
  const label = state === 'copied' ? t('content.copied') : state === 'failed' ? t('content.copyFailed') : t('content.copy');
  return <Button className={['structured-copy', className].filter(Boolean).join(' ')} onClick={copy} aria-label={label}>{label}</Button>;
}

function MarkdownContent({ value }: { value: string }) {
  return (
    <div className="structured-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false }]]}
        components={{
          a: ({ children, href }) => <span className="structured-link" title={href}>{children}</span>,
          img: ({ alt, src }) => <span className="structured-image" title={src}>{alt || '[image]'}</span>,
        }}
      >{value}</Markdown>
    </div>
  );
}

function fencedCode(value: string, language?: string): string {
  let fence = '```';
  while (value.includes(fence)) fence += '`';
  return `${fence}${language ?? ''}\n${value}\n${fence}`;
}

export function StructuredContent({ value, mode = 'auto', contentType, language, ariaLabel, className, allowSourceToggle = true, emptyFallback }: StructuredContentProps) {
  const { t } = useI18n();
  const detected = useMemo(() => detectStructuredContent(value, { mode, contentType, language }), [contentType, language, mode, value]);
  const [source, setSource] = useState(false);
  useEffect(() => setSource(false), [value, detected.kind]);
  const raw = copyText(value, detected.kind);
  const parsed = detected.kind === 'json' && typeof value === 'string' ? parsedContainer(value) : value;
  const empty = value === null || value === '';

  return (
    <div className={['structured-content', `structured-content--${detected.kind}`, className].filter(Boolean).join(' ')} data-content-kind={detected.kind}>
      <div className="structured-toolbar">
        {detected.kind === 'markdown' && allowSourceToggle && <Button className="structured-view-toggle" onClick={() => setSource((current) => !current)}>{source ? t('content.rendered') : t('content.source')}</Button>}
        <ContentCopyButton value={raw} />
      </div>
      {empty && emptyFallback !== undefined
        ? <div className="structured-empty">{emptyFallback}</div>
        : detected.kind === 'json' && parsed !== null && typeof parsed === 'object'
          ? <JsonView data={parsed} style={{ ...jsonStyles, ariaLables: { collapseJson: t('json.collapse'), expandJson: t('json.expand') } }} shouldExpandNode={expandAllNodes} clickToExpandNode aria-label={ariaLabel} />
          : detected.kind === 'json'
            ? <pre className="structured-text" aria-label={ariaLabel}>{JSON.stringify(value, null, 2)}</pre>
          : detected.kind === 'markdown' && !source
            ? <MarkdownContent value={String(value ?? '')} />
            : detected.kind === 'code' && !source
              ? <MarkdownContent value={fencedCode(String(value ?? ''), detected.language)} />
              : <pre className="structured-text" aria-label={ariaLabel}>{String(value ?? '')}</pre>}
    </div>
  );
}
