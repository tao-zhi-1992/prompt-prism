import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type http from 'node:http';
import type { Capture, CaptureIndexEntry, PromptPrismAnalyzer } from './types.js';

export interface PluginRuntimeContext {
  analysisPath: string;
  captures: readonly CaptureIndexEntry[];
  readCapture(id: string): Promise<Capture | null>;
  json(response: http.ServerResponse, status: number, value: unknown): void;
  reportError(pluginId: string, error: unknown): void;
}

export interface BuiltinPluginRuntime {
  readonly analyzer: PromptPrismAnalyzer;
  init(context: PluginRuntimeContext): Promise<void>;
  onCapture(capture: Capture, entry: CaptureIndexEntry): Promise<void>;
  onEvict(entry: CaptureIndexEntry): void;
  handleApi(pluginId: string, request: http.IncomingMessage, response: http.ServerResponse, subpath: string): Promise<boolean>;
}

type PluginBundle = { createBuiltinServerPluginRuntime(): BuiltinPluginRuntime };

export async function loadBuiltinPluginRuntime(): Promise<BuiltinPluginRuntime> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const bundlePath = path.basename(currentDir) === 'dist'
    ? path.join(currentDir, 'internal/plugins.js')
    : path.resolve(currentDir, '../dist/internal/plugins.js');
  const bundle = await import(pathToFileURL(bundlePath).href) as PluginBundle;
  if (typeof bundle.createBuiltinServerPluginRuntime !== 'function') throw new Error('Invalid built-in plugin bundle');
  return bundle.createBuiltinServerPluginRuntime();
}
