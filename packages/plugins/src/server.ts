import { createDiffServerPlugin } from './diff/server/index.js';
import { createRawServerPlugin } from './raw/server/index.js';
import { ServerPluginRegistry } from './registry/server.js';

export function createBuiltinServerPluginRuntime() {
  const diff = createDiffServerPlugin();
  const registry = new ServerPluginRegistry([diff, createRawServerPlugin()]);
  return {
    init: registry.init.bind(registry),
    onCapture: registry.onCapture.bind(registry),
    onEvict: registry.onEvict.bind(registry),
    handleApi: registry.handleApi.bind(registry),
    get analyzer() { return diff.getAnalyzer(); },
  };
}
