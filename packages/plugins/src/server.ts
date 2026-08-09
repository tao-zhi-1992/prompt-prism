import { createInputDiffServerPlugin } from './input-diff/server/index.js';
import { createOutputServerPlugin } from './output/server/index.js';
import { createRawServerPlugin } from './raw/server/index.js';
import { createTraceServerPlugin } from './trace/server/index.js';
import { ServerPluginRegistry } from './registry/server.js';

export function createBuiltinServerPluginRuntime() {
  const inputDiff = createInputDiffServerPlugin();
  const trace = createTraceServerPlugin({ getParentId: (id) => inputDiff.getAnalyzer().analyses.get(id)?.matched_parent_id });
  const registry = new ServerPluginRegistry([inputDiff, createOutputServerPlugin(), trace, createRawServerPlugin()]);
  return {
    init: registry.init.bind(registry),
    onCapture: registry.onCapture.bind(registry),
    onEvict: registry.onEvict.bind(registry),
    handleApi: registry.handleApi.bind(registry),
    get analyzer() { return inputDiff.getAnalyzer(); },
  };
}
