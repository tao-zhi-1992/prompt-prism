import { defineDetailTab } from '../../registry/dashboard.js';
import { inputDiffPluginMeta } from '../index.js';
import { InputDiffPanel, type InputDiffAnalysis } from './InputDiffPanel.js';
import './styles.css';

async function readJson(response: Response): Promise<InputDiffAnalysis> {
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error || `Request failed with ${response.status}`);
  return value as InputDiffAnalysis;
}

export const inputDiffDashboardPlugin = defineDetailTab<InputDiffAnalysis>({
  ...inputDiffPluginMeta,
  load: (capture, signal) => fetch(`/_pp/api/input-diff/${encodeURIComponent(capture.id)}`, { signal, cache: 'no-store' }).then(readJson),
  Panel: ({ data, loading, error, retry }) => <InputDiffPanel analysis={data} loading={loading} error={error} onRetry={retry} />,
});
