import type http from 'node:http';
import type { Capture, CaptureIndexEntry, PromptPrismServerPlugin, ServerPluginContext } from '@prompt-prism/contracts/server';

const PLUGIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_IDS = new Set(['logs', 'assets', 'brand', 'trace']);

export interface ServerPluginRuntime {
  init(context: ServerPluginContext): Promise<void>;
  onCapture(capture: Capture, entry: CaptureIndexEntry): Promise<void>;
  onEvict(entry: CaptureIndexEntry): void;
  onClear(): Promise<void>;
  handleApi(pluginId: string, request: http.IncomingMessage, response: http.ServerResponse, subpath: string): Promise<boolean>;
  readonly analyzer?: unknown;
}

export class ServerPluginRegistry implements ServerPluginRuntime {
  readonly plugins: readonly PromptPrismServerPlugin[];
  private context: ServerPluginContext | null = null;

  constructor(plugins: readonly PromptPrismServerPlugin[] = []) {
    const ids = new Set<string>();
    for (const plugin of plugins) {
      if (!PLUGIN_ID.test(plugin.id)) throw new Error(`Invalid plugin ID: ${plugin.id}`);
      if (RESERVED_IDS.has(plugin.id)) throw new Error(`Reserved plugin ID: ${plugin.id}`);
      if (ids.has(plugin.id)) throw new Error(`Duplicate plugin ID: ${plugin.id}`);
      ids.add(plugin.id);
    }
    this.plugins = [...plugins];
  }

  async init(context: ServerPluginContext): Promise<void> {
    this.context = context;
    for (const plugin of this.plugins) {
      try { await plugin.init?.(context); }
      catch (error) { throw new Error(`Plugin ${plugin.id} failed to initialize`, { cause: error }); }
    }
  }
  async onCapture(capture: Capture, entry: CaptureIndexEntry): Promise<void> {
    const context = this.requireContext();
    await Promise.all(this.plugins.map(async (plugin) => {
      try { await plugin.onCapture?.(capture, entry, context); }
      catch (error) { context.reportError(plugin.id, error); }
    }));
  }
  onEvict(entry: CaptureIndexEntry): void {
    const context = this.requireContext();
    for (const plugin of this.plugins) try { plugin.onEvict?.(entry, context); } catch (error) { context.reportError(plugin.id, error); }
  }
  async onClear(): Promise<void> {
    const context = this.requireContext();
    const results = await Promise.allSettled(this.plugins.map((plugin) => Promise.resolve().then(() => plugin.onClear?.(context))));
    const failures = results.flatMap((result, index) => result.status === 'rejected' ? [result.reason] : []);
    results.forEach((result, index) => { if (result.status === 'rejected') context.reportError(this.plugins[index]!.id, result.reason); });
    if (failures.length) throw new AggregateError(failures, 'One or more plugins failed to clear');
  }
  async handleApi(pluginId: string, request: http.IncomingMessage, response: http.ServerResponse, subpath: string): Promise<boolean> {
    const context = this.requireContext();
    const plugin = this.plugins.find((candidate) => candidate.id === pluginId);
    if (!plugin?.handleApi) return false;
    try { return await plugin.handleApi(request, response, subpath, context); }
    catch (error) { context.reportError(plugin.id, error); if (!response.headersSent) context.json(response, 500, { error: 'Plugin request failed' }); else response.end(); return true; }
  }
  private requireContext(): ServerPluginContext { if (!this.context) throw new Error('Plugin registry has not been initialized'); return this.context; }
}
