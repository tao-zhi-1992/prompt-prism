import { createPromptPrism, type Analysis, type Capture, type PromptPrismOptions, type Usage } from 'prompt-prism';

const options: PromptPrismOptions = {
  upstreamUrl: 'http://127.0.0.1:8787/v1/messages',
  apiFormat: 'anthropic',
  dataDir: './data',
  maxBytes: 1024,
  port: 0,
  host: '127.0.0.1',
  open: false
};

const usage: Usage = { input_tokens: 1, cache_read_input_tokens: 1 };
const capture: Capture = {
  id: 'capture',
  timestamp: new Date().toISOString(),
  token_hash: 'token',
  model: 'test-model',
  messages: [{ role: 'user', content: 'hello' }],
  usage
};

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
