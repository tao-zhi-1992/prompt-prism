import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Capture, CaptureIndexEntry, PromptPrismServerPlugin, ServerPluginContext } from '../contracts/server.js';
import { validatePluginId } from './validation.js';

export class ServerPluginRegistry {
  readonly plugins: readonly PromptPrismServerPlugin[];
  private context: ServerPluginContext | null = null;

  constructor(plugins: PromptPrismServerPlugin[] = []) {
    const ids = new Set<string>();
    for (const plugin of plugins) {
      validatePluginId(plugin.id, ids);
      ids.add(plugin.id);
    }
    this.plugins = [...plugins];
  }

  async init(context: ServerPluginContext): Promise<void> {
    this.context = context;
    for (const plugin of this.plugins) {
      try { await plugin.init?.(context); }
      catch (error: unknown) { throw new Error(`Plugin ${plugin.id} failed to initialize`, { cause: error }); }
    }
  }

  async onCapture(capture: Capture, entry: CaptureIndexEntry): Promise<void> {
    const context = this.requireContext();
    await Promise.all(this.plugins.map(async (plugin) => {
      try { await plugin.onCapture?.(capture, entry, context); }
      catch (error: unknown) { context.reportError(plugin.id, error); }
    }));
  }

  onEvict(entry: CaptureIndexEntry): void {
    const context = this.requireContext();
    for (const plugin of this.plugins) {
      try { plugin.onEvict?.(entry, context); }
      catch (error: unknown) { context.reportError(plugin.id, error); }
    }
  }

  async handleApi(pluginId: string, request: IncomingMessage, response: ServerResponse, subpath: string): Promise<boolean> {
    const context = this.requireContext();
    const plugin = this.plugins.find((candidate) => candidate.id === pluginId);
    if (!plugin?.handleApi) return false;
    try { return await plugin.handleApi(request, response, subpath, context); }
    catch (error: unknown) {
      context.reportError(plugin.id, error);
      if (!response.headersSent) context.json(response, 500, { error: 'Plugin request failed' });
      else response.end();
      return true;
    }
  }

  private requireContext(): ServerPluginContext {
    if (!this.context) throw new Error('Plugin registry has not been initialized');
    return this.context;
  }
}
