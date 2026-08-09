import { defineDetailTab } from '../../registry/dashboard.js';
import { diffPluginMeta } from '../index.js';
import { DiffPanel, type Analysis } from './DiffPanel.js';
import './styles.css';

async function readJson(response: Response): Promise<Analysis> {
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error || `Request failed with ${response.status}`);
  return value as Analysis;
}

export const diffDashboardPlugin = defineDetailTab<Analysis>({
  ...diffPluginMeta,
  load: (capture, signal) => fetch(`/_pp/api/diff/${encodeURIComponent(capture.id)}`, { signal, cache: 'no-store' }).then(readJson),
  Panel: ({ data, loading, error, retry }) => <DiffPanel analysis={data} loading={loading} error={error} onRetry={retry} />,
});
