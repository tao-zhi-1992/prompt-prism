import { defineDetailTab } from '../../registry/dashboard.js';
import { rawPluginMeta } from '../index.js';
import { RawPanel, type RawCapture } from './RawPanel.js';
import './styles.css';

async function readJson(response: Response): Promise<RawCapture> {
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error || `Request failed with ${response.status}`);
  return value as RawCapture;
}

export const rawDashboardPlugin = defineDetailTab<RawCapture>({
  ...rawPluginMeta,
  load: (capture, signal) => fetch(`/_pp/api/raw/${encodeURIComponent(capture.id)}`, { signal, cache: 'no-store' }).then(readJson),
  Panel: ({ data, loading, error, retry }) => <RawPanel raw={data} loading={loading} error={error} onRetry={retry} />,
});
