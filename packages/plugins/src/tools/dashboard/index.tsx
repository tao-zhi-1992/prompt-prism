import { defineDetailTab } from '../../registry/dashboard.js';
import { toolsPluginMeta } from '../index.js';
import { ToolsPanel, type ToolsData } from './ToolsPanel.js';
import './styles.css';

async function readJson(response: Response): Promise<ToolsData> {
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error || `Request failed with ${response.status}`);
  return value as ToolsData;
}

export const toolsDashboardPlugin = defineDetailTab<ToolsData>({
  ...toolsPluginMeta,
  load: (capture, signal) => fetch(`/_pp/api/tools/${encodeURIComponent(capture.id)}`, { signal, cache: 'no-store' }).then(readJson),
  Panel: ({ data, loading, error, retry, selectCapture }) => <ToolsPanel data={data} loading={loading} error={error} onRetry={retry} selectCapture={selectCapture} />,
});
