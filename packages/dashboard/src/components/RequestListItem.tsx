import type { CaptureSummary } from '../types';
import { formatHttpStatus, formatTime, httpStatusTone } from '../format';
import { useI18n } from '@prompt-prism/plugins/dashboard';

type Props = {
  capture: CaptureSummary;
  selected: boolean;
  onSelect: (id: string) => void;
};

export function RequestListItem({ capture, selected, onSelect }: Props) {
  const { t, locale } = useI18n();
  const tone = httpStatusTone(capture.response_status);

  return (
    <button
      className="request-item"
      data-selected={selected || undefined}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(capture.id)}
    >
      <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />
      <span className="request-copy">
        <span className="request-line request-line--primary">
          <strong>{capture.model || t('common.unknownModel')}</strong>
          <time dateTime={capture.timestamp}>{formatTime(capture.timestamp, locale)}</time>
        </span>
        <span className="request-line request-line--secondary">
          <span className={`status-label status-label--${tone}`}>{formatHttpStatus(capture.response_status)}</span>
          <span className="request-host" title={capture.upstream_host}>{capture.upstream_host || t('common.unknownHost')}</span>
          <span className="request-id" title={capture.id}>{capture.id.slice(0, 8)}</span>
        </span>
      </span>
    </button>
  );
}
