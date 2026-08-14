import { defineDetailTab } from '@prompt-prism/dashboard-kit';
import { tracePluginMeta } from '../index.js';
import { TracePanel, type TraceResult } from './TracePanel.js';
import './styles.css';

async function readJson(response: Response): Promise<TraceResult> {
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error || `Request failed with ${response.status}`);
  return value as TraceResult;
}

export const traceDashboardPlugin = defineDetailTab<TraceResult>({
  ...tracePluginMeta,
  pollIntervalMs: 3000,
  load: (capture, signal) => fetch(`/_pp/api/trace/${encodeURIComponent(capture.id)}`, { signal, cache: 'no-store' }).then(readJson),
  Panel: ({ data, loading, error, refreshError, retry, selectCapture }) => (
    <TracePanel trace={data} loading={loading} error={error} refreshError={refreshError} onRetry={retry} selectCapture={selectCapture} />
  ),
});
