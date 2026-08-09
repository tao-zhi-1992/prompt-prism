import type http from 'node:http';

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
}

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

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

export interface Capture {
  id: string;
  timestamp: string;
  token_hash: string;
  model: string | null;
  messages: Message[];
  adapter_id?: string;
  prompt_input?: ModelInputSnapshot;
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
  upstreamUrl?: string | URL;
  apiFormat?: string;
  dataDir?: string;
  maxBytes?: number;
  port?: number;
  host?: string;
  open?: boolean;
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
  upstreamUrl: URL;
  apiFormat: string;
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
}
