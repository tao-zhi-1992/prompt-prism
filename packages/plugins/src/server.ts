import { createInputDiffServerPlugin } from './input-diff/server/index.js';
import { createRawServerPlugin } from './raw/server/index.js';
import { ServerPluginRegistry } from './registry/server.js';

export function createBuiltinServerPluginRuntime() {
  const inputDiff = createInputDiffServerPlugin();
  const registry = new ServerPluginRegistry([inputDiff, createRawServerPlugin()]);
  return {
    init: registry.init.bind(registry),
    onCapture: registry.onCapture.bind(registry),
    onEvict: registry.onEvict.bind(registry),
    handleApi: registry.handleApi.bind(registry),
    get analyzer() { return inputDiff.getAnalyzer(); },
  };
}
