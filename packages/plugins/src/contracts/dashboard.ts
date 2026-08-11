import type { ComponentType, ReactNode } from 'react';

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface CaptureTiming {
  started_at: string;
  completed_at: string;
  duration_ms: number;
  time_to_headers_ms: number;
  time_to_first_byte_ms: number | null;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[];
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

export interface ConversationTextBlock { type: 'text'; text: string; }
export interface ConversationReasoningBlock { type: 'reasoning'; text: string; }
export interface ConversationToolCallBlock { type: 'tool_call'; id: string | null; name: string; input: JsonValue | null; input_raw?: string; }
export interface ConversationToolResultBlock { type: 'tool_result'; tool_call_id: string | null; content: JsonValue; is_error: boolean | null; }
export interface ConversationUnknownBlock { type: 'unknown'; provider_type: string; value: JsonValue; }
export type ConversationContentBlock = ConversationTextBlock | ConversationReasoningBlock | ConversationToolCallBlock | ConversationToolResultBlock | ConversationUnknownBlock;
export interface ConversationMessage { role: string; content: ConversationContentBlock[]; }

export interface CaptureSummary {
  id: string;
  timestamp: string;
  token_hash: string;
  model: string | null;
  usage?: Usage;
  response_status?: number | null;
  upstream_host?: string;
  trace_id?: string;
  trace_group_id?: string;
  trace_group_source?: 'explicit' | 'inferred';
  timing?: CaptureTiming;
  file_ref: string;
  analysis?: unknown;
}

export interface DetailTabPanelProps<Data> {
  capture: CaptureSummary;
  data: Data | null;
  loading: boolean;
  error: string | null;
  refreshError: string | null;
  retry: () => void;
  selectCapture: (id: string) => void;
}

export interface DetailTabPluginDefinition<Data> {
  id: string;
  label: string;
  order: number;
  pollIntervalMs?: number;
  load?: (capture: CaptureSummary, signal: AbortSignal) => Promise<Data>;
  Panel: ComponentType<DetailTabPanelProps<Data>>;
}

export interface DetailTabPlugin {
  id: string;
  label: string;
  order: number;
  pollIntervalMs?: number;
  load?: (capture: CaptureSummary, signal: AbortSignal) => Promise<unknown>;
  render: (props: DetailTabPanelProps<unknown>) => ReactNode;
}
