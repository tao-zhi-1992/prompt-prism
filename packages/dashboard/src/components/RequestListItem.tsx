import type { CaptureSummary } from '../types';
import { formatHttpStatus, formatTime, httpStatusTone } from '../format';
import { traceDisplayName, useI18n } from '@prompt-prism/plugins/dashboard';

type Props = {
  capture: CaptureSummary;
  selected: boolean;
  onSelect: (id: string, tab?: string) => void;
  onTraceClick: (id: string) => void;
};

export function RequestListItem({ capture, selected, onSelect, onTraceClick }: Props) {
  const { t, locale } = useI18n();
  const tone = httpStatusTone(capture.response_status);
  const traceGroupId = capture.trace_group_id ?? capture.trace_id;
  const traceGroupSource = capture.trace_group_source ?? 'explicit';
  const traceGroupIndex = capture.trace_group_index ?? 1;
  const traceName = traceGroupId ? traceDisplayName(traceGroupId) : null;

  return <div className="request-item-shell">
    <button
      className="request-item ui-interactive"
      data-selected={selected || undefined}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(capture.id)}
    >
      <span className="request-copy">
        <span className="request-line request-line--primary">
          <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />
          <strong>{capture.model || t('common.unknownModel')}</strong>
          <time dateTime={capture.timestamp}>{formatTime(capture.timestamp, locale)}</time>
        </span>
        <span className="request-line request-line--host" title={capture.upstream_host}>
          {capture.upstream_host}
        </span>
        <span className="request-line request-line--secondary">
          <span className={`status-label status-label--${tone}`}>{formatHttpStatus(capture.response_status)}</span>
          <span className="request-id" title={capture.id}>{capture.id.slice(0, 8)}</span>
        </span>
      </span>
    </button>
    {traceGroupId && <button
      type="button"
      className={`trace-badge trace-badge--${traceGroupSource}`}
      title={traceGroupId}
      aria-label={t('trace.openFirstRequest', { id: traceName!, index: traceGroupIndex })}
      onClick={() => onTraceClick(capture.id)}
    >trace:{traceName} #{traceGroupIndex}</button>}
  </div>;
}
