import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { createPromptPrism } from '../../src/proxy.js';
import { buildDynamicProxyBaseUrl } from '../../src/upstream.js';
import { close, listen } from './helpers/http.js';

test('official OpenAI and Anthropic JavaScript SDKs preserve dynamic upstream path prefixes', async (t) => {
  const seen: string[] = [];
  const upstream = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      seen.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'application/json' });
      if (request.url?.endsWith('/chat/completions')) {
        response.end(JSON.stringify({ id: 'chatcmpl_sdk', object: 'chat.completion', created: 1, model: 'sdk-openai', choices: [{ index: 0, message: { role: 'assistant', content: 'openai sdk' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } }));
      } else {
        response.end(JSON.stringify({ id: 'msg_sdk', type: 'message', role: 'assistant', model: 'sdk-anthropic', content: [{ type: 'text', text: 'anthropic sdk' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 2, output_tokens: 2 } }));
      }
    });
  });
  const upstreamPort = await listen(upstream);
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-sdk-dynamic-'));
  const prism = await createPromptPrism({ upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/fixed`, dataDir: dir });
  const proxyPort = await listen(prism.server);
  t.after(async () => { await close(prism.server); await close(upstream); });

  const proxyOrigin = `http://127.0.0.1:${proxyPort}`;
  const openai = new OpenAI({
    apiKey: 'openai-test-key',
    baseURL: buildDynamicProxyBaseUrl(`http://127.0.0.1:${upstreamPort}/openai/v1`, proxyOrigin),
    maxRetries: 0,
  });
  const anthropic = new Anthropic({
    apiKey: 'anthropic-test-key',
    baseURL: buildDynamicProxyBaseUrl(`http://127.0.0.1:${upstreamPort}/anthropic`, proxyOrigin),
    maxRetries: 0,
  });

  const openaiResponse = await openai.chat.completions.create({ model: 'sdk-openai', messages: [{ role: 'user', content: 'hello' }] });
  const anthropicResponse = await anthropic.messages.create({ model: 'sdk-anthropic', max_tokens: 16, messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(openaiResponse.choices[0]?.message.content, 'openai sdk');
  assert.equal(anthropicResponse.content[0]?.type, 'text');
  assert.deepEqual(seen, ['/openai/v1/chat/completions', '/anthropic/v1/messages']);

  await new Promise<void>((resolve) => setImmediate(resolve));
  await prism.store.pending;
  assert.deepEqual(prism.store.captures.map(({ adapter_id }) => adapter_id), ['openai-chat-completions', 'anthropic-messages']);
});
