import { createInputDiffServerPlugin } from './input-diff/server/index.js';
import { createOutputServerPlugin } from './output/server/index.js';
import { createRawServerPlugin } from './raw/server/index.js';
import { createSystemPromptServerPlugin } from './system-prompt/server/index.js';
import { createTraceServerPlugin } from './trace/server/index.js';
import { ServerPluginRegistry } from './registry/server.js';
import { createInsightsServerPlugin } from './insights/server/index.js';
import { createToolsServerPlugin } from './tools/server/index.js';

export function createBuiltinServerPluginRuntime({ getParentId = () => null }: { getParentId?: (id: string) => string | null | undefined } = {}) {
  const inputDiff = createInputDiffServerPlugin();
  const trace = createTraceServerPlugin({ getParentId });
  const insights = createInsightsServerPlugin({ getParentId });
  const registry = new ServerPluginRegistry([inputDiff, createOutputServerPlugin(), createToolsServerPlugin(), trace, createRawServerPlugin(), createSystemPromptServerPlugin(), insights]);
  return {
    init: registry.init.bind(registry),
    onCapture: registry.onCapture.bind(registry),
    onEvict: registry.onEvict.bind(registry),
    onClear: registry.onClear.bind(registry),
    handleApi: registry.handleApi.bind(registry),
    get analyzer() { return inputDiff.getAnalyzer(); },
  };
}
