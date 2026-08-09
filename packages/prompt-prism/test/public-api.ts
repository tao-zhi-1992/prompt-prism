import { createPromptPrism, parseUpstreamBaseUrl, type Analysis, type ApiFormatResolution, type Capture, type CaptureTiming, type ConversationMessage, type ConversationToolCallBlock, type InsightComparison, type InsightEvidence, type InsightFinding, type InsightReport, type InsightRunSummary, type ModelOutputSnapshot, type PromptPrismOptions, type ProviderProtocol, type Usage } from 'prompt-prism';

const options: PromptPrismOptions = {
  upstreamBaseUrl: parseUpstreamBaseUrl('https://api.anthropic.com'),
  apiFormat: 'auto',
  dataDir: './data',
  maxBytes: 1024,
  port: 0,
  host: '127.0.0.1',
  open: false
};

const protocol: ProviderProtocol = 'anthropic-messages';
const resolution: ApiFormatResolution = { mode: 'auto', configured: 'auto', resolved: protocol, source: 'upstream-url' };
void resolution;

const usage: Usage = { input_tokens: 1, cache_read_input_tokens: 1 };
const timing: CaptureTiming = { started_at: new Date().toISOString(), completed_at: new Date().toISOString(), duration_ms: 1, time_to_headers_ms: 1, time_to_first_byte_ms: 1 };
const conversation: ConversationMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }];
const malformedToolCall: ConversationToolCallBlock = { type: 'tool_call', id: 'call', name: 'read', input: null, input_raw: '{bad' };
void malformedToolCall;
const output: ModelOutputSnapshot = {
  adapter_id: 'anthropic-messages', id: 'message', model: 'test-model', role: 'assistant', stop_reason: 'end_turn',
  content: [{ type: 'text', text: 'hello' }], usage,
};
const capture: Capture = {
  id: 'capture',
  timestamp: new Date().toISOString(),
  token_hash: 'token',
  model: 'test-model',
  messages: [{ role: 'user', content: 'hello' }],
  usage,
  trace_id: 'session:one',
  timing,
  prompt_input: { adapter_id: 'anthropic-messages', primary_section_id: 'messages', sections: [], conversation },
  model_output: output,
};

type InsightTypes = [InsightRunSummary, InsightReport, InsightFinding, InsightComparison, InsightEvidence];
const insightTypes = null as unknown as InsightTypes;
void insightTypes;

const analysis: Analysis = {
  id: capture.id,
  timestamp: capture.timestamp,
  matched_parent_id: null,
  matched_message_count: 0,
  divergence_point: 0,
  diff: [{ type: 'insert', value: 'hello' }],
  estimated_cacheable_tokens: 0,
  actual_cache_read_tokens: 0,
  estimated_cache_miss: 0,
  cache_hit_below_expected: false
};

void createPromptPrism(options).then((instance) => {
  const server = instance.server;
  const format = instance.apiFormat;
  const storedAnalysis = instance.analyzer.analyses.get(analysis.id);
  return [server, format, storedAnalysis];
});
