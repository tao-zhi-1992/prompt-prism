export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export type DiffPart = {
  type: 'equal' | 'insert' | 'delete';
  value: string;
};

export type Analysis = {
  id: string;
  timestamp: string;
  matched_parent_id: string | null;
  matched_message_count: number;
  divergence_point: number;
  diff: DiffPart[];
  estimated_cacheable_tokens: number;
  actual_cache_read_tokens: number;
  estimated_cache_miss: number;
  cache_hit_below_expected: boolean;
};

export type CaptureSummary = {
  id: string;
  timestamp: string;
  token_hash: string;
  model: string | null;
  usage?: Usage;
  file_ref: string;
  analysis: Omit<Analysis, 'diff'> | null;
};
