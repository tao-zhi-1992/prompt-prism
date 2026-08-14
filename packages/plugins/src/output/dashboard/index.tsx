import { defineDetailTab } from '@prompt-prism/dashboard-kit';
import { outputPluginMeta } from '../index.js';
import { OutputPanel, type OutputCapture } from './OutputPanel.js';
import './styles.css';

async function readJson(response: Response): Promise<OutputCapture> {
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error || `Request failed with ${response.status}`);
  return value as OutputCapture;
}

export const outputDashboardPlugin = defineDetailTab<OutputCapture>({
  ...outputPluginMeta,
  load: (capture, signal) => fetch(`/_pp/api/output/${encodeURIComponent(capture.id)}`, { signal, cache: 'no-store' }).then(readJson),
  Panel: ({ data, loading, error, retry }) => <OutputPanel result={data} loading={loading} error={error} onRetry={retry} />,
});
