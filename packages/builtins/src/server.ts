import { ServerPluginRegistry, type ServerPluginRuntime } from '@prompt-prism/core';
import { createInputDiffServerPlugin, createInsightsServerPlugin, createOutputServerPlugin, createRawServerPlugin, createSystemPromptServerPlugin, createToolsServerPlugin } from '@prompt-prism/plugins/server';

export function createBuiltinServerPluginRuntime(): ServerPluginRuntime {
  const inputDiff = createInputDiffServerPlugin();
  const registry = new ServerPluginRegistry([inputDiff, createOutputServerPlugin(), createToolsServerPlugin(), createRawServerPlugin(), createSystemPromptServerPlugin(), createInsightsServerPlugin()]);
  return Object.assign(registry, {
    get analyzer() {
      return { get analyses() { return inputDiff.getAnalyzer().analyses; } };
    },
  });
}
