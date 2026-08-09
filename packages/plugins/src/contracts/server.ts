import type { IncomingMessage, ServerResponse } from 'node:http';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue | undefined; }

export interface Message extends JsonObject {
  role?: string;
  content?: JsonValue;
}

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface RawRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface RawResponse {
  status: number | null;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface Capture {
  id: string;
  timestamp: string;
  token_hash: string;
  model: string | null;
  messages: Message[];
  usage: Usage;
  upstream_host?: string;
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
  file_ref: string;
  messages: Message[];
}

export interface ServerPluginContext {
  analysisPath: string;
  captures: readonly CaptureIndexEntry[];
  readCapture(id: string): Promise<Capture | null>;
  json(response: ServerResponse, status: number, value: unknown): void;
  reportError(pluginId: string, error: unknown): void;
}

export interface PromptPrismServerPlugin {
  id: string;
  init?(context: ServerPluginContext): Promise<void>;
  onCapture?(capture: Capture, entry: CaptureIndexEntry, context: ServerPluginContext): Promise<void>;
  onEvict?(entry: CaptureIndexEntry, context: ServerPluginContext): void;
  handleApi?(request: IncomingMessage, response: ServerResponse, subpath: string, context: ServerPluginContext): Promise<boolean>;
}
