import type http from 'node:http';

export type ProviderProtocol = 'anthropic-messages' | 'openai-chat-completions';
export type ApiFormatOption = 'auto' | ProviderProtocol | 'anthropic' | 'openai';
export type ApiFormatResolutionSource = 'explicit' | 'upstream-url' | 'upstream-base-url' | 'request-path' | 'request-headers' | 'request-shape' | 'response-shape' | null;
export interface ApiFormatResolution {
  mode: 'auto' | 'explicit';
  configured: 'auto' | ProviderProtocol;
  resolved: ProviderProtocol | null;
  source: ApiFormatResolutionSource;
  unsupported_protocol?: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue | undefined; }

export interface Message extends JsonObject {
  role?: string;
  content?: JsonValue;
}

export type ModelInputCompareMode = 'sequence' | 'json';

export interface ModelInputSection {
  id: string;
  label: string;
  order: number;
  value: JsonValue;
  compare_as: ModelInputCompareMode;
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

export interface TextOutputBlock {
  type: 'text';
  text: string;
}

export interface ReasoningOutputBlock {
  type: 'reasoning';
  text: string;
}

export interface ToolCallOutputBlock {
  type: 'tool_call';
  id: string | null;
  name: string;
  input: JsonValue | null;
  input_raw?: string;
}

export interface UnknownOutputBlock {
  type: 'unknown';
  provider_type: string;
  value: JsonValue;
}

export type ModelOutputBlock = TextOutputBlock | ReasoningOutputBlock | ToolCallOutputBlock | UnknownOutputBlock;

export interface ProviderError {
  type: string | null;
  message: string;
  details?: JsonValue;
}

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

export type DiffType = 'equal' | 'insert' | 'delete';

export interface DiffPart {
  type: DiffType;
  value: string;
}

export interface Analysis {
  id: string;
  timestamp: string;
  matched_parent_id: string | null;
  matched_message_count: number;
  divergence_point: number;
  diff: DiffPart[];
  sections?: InputDiffSection[];
  estimated_cacheable_tokens: number;
  actual_cache_read_tokens: number;
  estimated_cache_miss: number;
  cache_hit_below_expected: boolean;
}

export type InputDiffSectionState = 'changed' | 'unchanged' | 'baseline' | 'empty' | 'unavailable';

export interface InputDiffSection {
  id: string;
  label: string;
  order: number;
  state: InputDiffSectionState;
  default_collapsed: boolean;
  diff: DiffPart[];
}

export type InputDiffAnalysis = Analysis;

export interface PromptPrismOptions {
  upstreamBaseUrl?: string | URL;
  upstreamUrl?: string | URL;
  apiFormat?: ApiFormatOption;
  dataDir?: string;
  maxBytes?: number;
  port?: number;
  host?: string;
  open?: boolean;
  allowRemoteDynamicUpstream?: boolean;
}

export interface PromptPrismStore {
  readonly captures: CaptureIndexEntry[];
  readonly pending: Promise<unknown>;
  readCapture(id: string): Promise<Capture | null>;
  writeCapture(capture: Capture): Promise<CaptureIndexEntry | null>;
}

export interface PromptPrismAnalyzer {
  readonly analyses: Map<string, Analysis>;
}

export interface PromptPrismInstance {
  server: http.Server;
  store: PromptPrismStore;
  analyzer: PromptPrismAnalyzer;
  upstreamUrl: URL | null;
  upstreamMode: 'base' | 'exact' | 'none';
  apiFormat: ApiFormatResolution;
}

export interface StartedPromptPrism extends PromptPrismInstance {
  port: number;
  dashboard: string;
}

export interface ParentMatch {
  id: string;
  messages: Message[];
  score: { messages: number; chars: number };
}

export interface ProviderRequest {
  model: string | null;
  messages: Message[];
  input: ModelInputSnapshot;
}

export interface ProviderResponse {
  usage: Usage;
  output: ModelOutputSnapshot | null;
}

export interface InsightTokenMetrics {
  uncached_input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_write_input_tokens: number;
  input_total_tokens: number;
  cache_hit_rate: number | null;
}

export interface InsightTimingMetrics {
  trace_span_ms: number | null;
  model_duration_ms: number | null;
  average_time_to_first_byte_ms: number | null;
  inter_call_gap_ms: number | null;
}

export interface InsightRunSummary {
  run_id: string;
  trace_id: string | null;
  source: 'explicit' | 'inferred';
  truncated: boolean;
  started_at: string;
  completed_at: string;
  calls: number;
  models: string[];
  upstream_hosts: string[];
  response_statuses: number[];
  status: 'ok' | 'error' | 'unknown';
  tokens: InsightTokenMetrics;
  timing: InsightTimingMetrics;
}

export interface InsightSectionMetrics {
  id: string;
  label: string;
  chars: number;
  bytes: number;
  fingerprint: string;
  changes: number;
}

export interface InsightToolNameMetrics {
  name: string;
  calls: number;
  errors: number;
  invalid_arguments: number;
  repeated_calls: number;
  result_bytes: number;
}

export interface InsightToolMetrics {
  calls: number;
  errors: number;
  invalid_arguments: number;
  repeated_calls: number;
  result_bytes: number;
  by_name: InsightToolNameMetrics[];
}

export interface InsightEvidenceLocation {
  capture_id: string;
  section?: string;
  tool?: string;
  metric?: string;
  value?: string | number | boolean | null;
  threshold?: number;
}

export interface InsightFinding {
  code: string;
  scope: string;
  severity: 'info' | 'warning' | 'error';
  summary: string;
  recommendation: string;
  evidence: InsightEvidenceLocation[];
}

export interface InsightCallMetrics {
  capture_id: string;
  timestamp: string;
  model: string | null;
  upstream_host?: string;
  response_status?: number | null;
  input_relation: 'root' | 'append' | 'rewritten';
  usage: Usage;
  timing: CaptureTiming | null;
  sections: Array<Omit<InsightSectionMetrics, 'changes'>>;
  tool_calls: number;
  tool_results: number;
  tool_errors: number;
  tool_result_bytes: number;
  output_blocks: Record<string, number>;
  stop_reason: string | null;
}

export interface InsightReport {
  schema_version: 1;
  run: InsightRunSummary;
  sections: InsightSectionMetrics[];
  tools: InsightToolMetrics;
  calls: InsightCallMetrics[];
  findings: InsightFinding[];
}

export interface InsightMetricDelta {
  before: number | null;
  after: number | null;
  absolute: number | null;
  percent: number | null;
}

export interface InsightComparison {
  schema_version: 1;
  baseline: InsightRunSummary;
  candidate: InsightRunSummary;
  metrics: Record<string, InsightMetricDelta>;
  tools_by_name: Array<{ name: string; calls: InsightMetricDelta; errors: InsightMetricDelta; repeated_calls: InsightMetricDelta; result_bytes: InsightMetricDelta }>;
  findings: { added: InsightFinding[]; resolved: InsightFinding[]; persisting: InsightFinding[] };
}

export interface InsightEvidence {
  schema_version: 1;
  capture_id: string;
  section: string;
  encoding: 'json';
  content: string;
  original_bytes: number;
  returned_bytes: number;
  truncated: boolean;
}
