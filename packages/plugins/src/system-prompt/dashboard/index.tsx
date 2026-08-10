import { defineDetailTab } from '../../registry/dashboard.js';
import { systemPromptPluginMeta } from '../index.js';
import { SystemPromptPanel, type SystemPromptData } from './SystemPromptPanel.js';
import './styles.css';

async function readJson(response: Response): Promise<SystemPromptData> {
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error || `Request failed with ${response.status}`);
  return value as SystemPromptData;
}

export const systemPromptDashboardPlugin = defineDetailTab<SystemPromptData>({
  ...systemPromptPluginMeta,
  load: (capture, signal) => fetch(`/_pp/api/system-prompt/${encodeURIComponent(capture.id)}`, { signal, cache: 'no-store' }).then(readJson),
  Panel: ({ data, loading, error, retry }) => <SystemPromptPanel data={data} loading={loading} error={error} onRetry={retry} />,
});
