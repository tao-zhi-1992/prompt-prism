import type { CaptureSummary } from '../types';
import { cachePercent, formatNumber, totalInputTokens } from '../format';

export function DetailHeader({ capture }: { capture: CaptureSummary }) {
  const input = totalInputTokens(capture.usage);
  const cached = capture.usage?.cache_read_input_tokens;
  const percent = cachePercent(input, cached);

  return (
    <header className="detail-header">
      <div className="detail-title-row">
        <div>
          <span className="eyebrow">Request details</span>
          <h2>{capture.model || 'Unknown model'}</h2>
        </div>
        <span className="request-id" title={capture.id}>#{capture.id.slice(0, 8)}</span>
      </div>
      <div className="detail-meta">
        <span><b>{formatNumber(input)}</b> total input</span>
        <span><b>{formatNumber(cached)}</b> cache read</span>
        <span><b>{percent === null ? '—' : `${percent}%`}</b> cached</span>
        <span title={capture.token_hash}><b>{capture.token_hash.slice(0, 8)}</b> token</span>
      </div>
    </header>
  );
}
