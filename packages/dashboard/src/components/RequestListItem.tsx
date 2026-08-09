import type { CaptureSummary } from '../types';
import { cachePercent, formatNumber, formatTime, totalInputTokens } from '../format';

type Props = {
  capture: CaptureSummary;
  selected: boolean;
  onSelect: (id: string) => void;
};

export function RequestListItem({ capture, selected, onSelect }: Props) {
  const input = totalInputTokens(capture.usage);
  const cached = capture.usage?.cache_read_input_tokens;
  const percent = cachePercent(input, cached);
  const status = !capture.analysis
    ? { label: 'Analyzing', tone: 'pending' }
    : !capture.analysis.matched_parent_id
      ? { label: 'Baseline', tone: 'neutral' }
      : capture.analysis.cache_hit_below_expected
        ? { label: 'Below expected', tone: 'bad' }
        : { label: 'As expected', tone: 'good' };

  return (
    <button
      className="request-item"
      data-selected={selected || undefined}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(capture.id)}
    >
      <span className={`status-dot status-dot--${status.tone}`} aria-hidden="true" />
      <span className="request-copy">
        <span className="request-line request-line--primary">
          <strong>{capture.model || 'Unknown model'}</strong>
          <time dateTime={capture.timestamp}>{formatTime(capture.timestamp)}</time>
        </span>
        <span className="request-line request-line--secondary">
          <span className={`status-label status-label--${status.tone}`}>{status.label}</span>
          <span>{formatNumber(cached)} cached</span>
          <span>{percent === null ? '—' : `${percent}%`}</span>
        </span>
      </span>
    </button>
  );
}
