import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CaptureTiming, Message, ModelInputSnapshot, ModelOutputSnapshot, Usage } from './model.js';
export type * from './model.js';
export interface ProviderRequest { model: string | null; messages: Message[]; input: ModelInputSnapshot; }
export interface ProviderResponse { usage: Usage; output: ModelOutputSnapshot | null; }

export type RawHeaders = Record<string, string | string[] | undefined>;

export interface RawRequest {
  method: string;
  url: string;
  target_url?: string;
  headers: RawHeaders;
  body: string;
}

export interface RawResponse {
  status: number | null;
  headers: RawHeaders;
  body: string;
}

export interface Capture {
  id: string;
  timestamp: string;
  token_hash: string;
  model: string | null;
  messages: Message[];
  adapter_id?: string;
  prompt_input?: ModelInputSnapshot;
  model_output?: ModelOutputSnapshot;
  trace_id?: string;
  usage: Usage;
  upstream_host?: string;
  timing?: CaptureTiming;
  request?: RawRequest;
  response?: RawResponse;
  [key: string]: unknown;
}

export interface CaptureIndexEntry {
  id: string;
  timestamp: string;
  token_hash: string;
  model: string | null;
  usage: Usage;
  response_status?: number | null;
  upstream_host?: string;
  trace_id?: string;
  timing?: CaptureTiming;
  file_ref: string;
  messages: Message[];
  adapter_id?: string;
  prompt_input?: ModelInputSnapshot;
}

export interface ServerPluginContext {
  analysisPath: string;
  captures: readonly CaptureIndexEntry[];
  readCapture(id: string): Promise<Capture | null>;
  getTraceParent?: (id: string) => string | null | undefined;
  parseProviderRequest(adapterId: string, body: string): ProviderRequest;
  parseProviderResponse(adapterId: string, body: string, contentType?: string): ProviderResponse;
  json(response: ServerResponse, status: number, value: unknown): void;
  reportError(pluginId: string, error: unknown): void;
}

export interface PromptPrismServerPlugin {
  id: string;
  init?(context: ServerPluginContext): Promise<void>;
  onCapture?(capture: Capture, entry: CaptureIndexEntry, context: ServerPluginContext): Promise<void>;
  onEvict?(entry: CaptureIndexEntry, context: ServerPluginContext): void;
  onClear?(context: ServerPluginContext): Promise<void> | void;
  handleApi?(request: IncomingMessage, response: ServerResponse, subpath: string, context: ServerPluginContext): Promise<boolean>;
}
