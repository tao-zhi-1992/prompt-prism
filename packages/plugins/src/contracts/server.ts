import type { IncomingMessage, ServerResponse } from 'node:http';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue | undefined; }

export interface Message extends JsonObject {
  role?: string;
  content?: JsonValue;
}

export interface ModelInputSection {
  id: string;
  label: string;
  order: number;
  value: JsonValue;
  compare_as: 'sequence' | 'json';
  default_collapsed: boolean;
}

export interface ModelInputSnapshot {
  adapter_id: string;
  primary_section_id: string;
  primary_sequence?: JsonValue[];
  sections: ModelInputSection[];
  conversation?: ConversationMessage[];
}

export interface ConversationTextBlock { type: 'text'; text: string; }
export interface ConversationReasoningBlock { type: 'reasoning'; text: string; }
export interface ConversationToolCallBlock { type: 'tool_call'; id: string | null; name: string; input: JsonValue | null; input_raw?: string; }
export interface ConversationToolResultBlock { type: 'tool_result'; tool_call_id: string | null; content: JsonValue; is_error: boolean | null; }
export interface ConversationUnknownBlock { type: 'unknown'; provider_type: string; value: JsonValue; }
export type ConversationContentBlock = ConversationTextBlock | ConversationReasoningBlock | ConversationToolCallBlock | ConversationToolResultBlock | ConversationUnknownBlock;
export interface ConversationMessage { role: string; content: ConversationContentBlock[]; }

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface TextOutputBlock { type: 'text'; text: string; }
export interface ReasoningOutputBlock { type: 'reasoning'; text: string; }
export interface ToolCallOutputBlock { type: 'tool_call'; id: string | null; name: string; input: JsonValue | null; input_raw?: string; }
export interface UnknownOutputBlock { type: 'unknown'; provider_type: string; value: JsonValue; }
export type ModelOutputBlock = TextOutputBlock | ReasoningOutputBlock | ToolCallOutputBlock | UnknownOutputBlock;
export interface ProviderError { type: string | null; message: string; details?: JsonValue; }
export interface ModelOutputSnapshot {
  adapter_id: string;
  id: string | null;
  model: string | null;
  role: string | null;
  stop_reason: string | null;
  content: ModelOutputBlock[];
  usage: Usage;
  error?: ProviderError;
}
export interface ProviderRequest { model: string | null; messages: Message[]; input: ModelInputSnapshot; }
export interface ProviderResponse { usage: Usage; output: ModelOutputSnapshot | null; }

export type RawHeaders = Record<string, string | string[] | undefined>;

export interface RawRequest {
  method: string;
  url: string;
  headers: RawHeaders;
  body: string;
}

export interface RawResponse {
  status: number | null;
  headers: RawHeaders;
  body: string;
}

export interface CaptureTiming {
  started_at: string;
  completed_at: string;
  duration_ms: number;
  time_to_headers_ms: number;
  time_to_first_byte_ms: number | null;
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
  handleApi?(request: IncomingMessage, response: ServerResponse, subpath: string, context: ServerPluginContext): Promise<boolean>;
}
