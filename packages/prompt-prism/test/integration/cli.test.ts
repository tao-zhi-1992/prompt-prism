import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildDynamicProxyBaseUrl } from '../../src/upstream.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../../bin/pp.js', import.meta.url));
const listen = (server: http.Server): Promise<number> => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
const close = (server: http.Server): Promise<void> => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

const runSummary = {
  run_id: 'run-one', trace_id: 'trace-one', source: 'explicit', truncated: false,
  started_at: '2026-08-09T00:00:00.000Z', completed_at: '2026-08-09T00:00:01.000Z', calls: 2,
  models: ['model'], upstream_hosts: ['api.example.com'], response_statuses: [200], status: 'ok',
  tokens: { uncached_input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_write_input_tokens: 10, input_total_tokens: 160, cache_hit_rate: 0.3125 },
  timing: { trace_span_ms: 1000, model_duration_ms: 700, average_time_to_first_byte_ms: 100, inter_call_gap_ms: 300 },
};

function insightsServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let status = 200;
    let value: unknown;
    if (url.pathname.endsWith('/runs')) value = { schema_version: 1, runs: [runSummary] };
    else if (url.pathname.endsWith('/report/run-one')) value = { schema_version: 1, run: runSummary, sections: [], tools: { calls: 1, errors: 0, invalid_arguments: 0, repeated_calls: 0, result_bytes: 10, by_name: [] }, calls: [], findings: [] };
    else if (url.pathname.endsWith('/compare')) value = { schema_version: 1, baseline: runSummary, candidate: runSummary, metrics: { calls: { before: 2, after: 2, absolute: 0, percent: 0 } }, tools_by_name: [], findings: { added: [], resolved: [], persisting: [] } };
    else if (url.pathname.endsWith('/evidence/capture-one')) value = { schema_version: 1, capture_id: 'capture-one', section: url.searchParams.get('section'), encoding: 'json', content: '{"name":"read"}', original_bytes: 15, returned_bytes: 15, truncated: false };
    else { status = 404; value = { code: 'run_not_found', error: 'Run not found' }; }
    const body = JSON.stringify(value);
    response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    response.end(body);
  });
}

test('CLI documents base and exact upstream modes with automatic API format', async () => {
  const { stdout } = await run(process.execPath, [cli, '--help']);
  assert.match(stdout, /--upstream-base-url URL/);
  assert.match(stdout, /--upstream-url URL/);
  assert.match(stdout, /--api-format FORMAT/);
  assert.match(stdout, /available: auto, anthropic-messages, openai-chat-completions/);
  assert.match(stdout, /p2 insights/);
  assert.match(stdout, /p2 url UPSTREAM_BASE_URL/);
  assert.doesNotMatch(stdout, /--base-url|--target|\btarget\b/i);
});

test('CLI generates copyable dynamic proxy Base URLs with a configurable proxy origin', async () => {
  const defaultResult = await run(process.execPath, [cli, 'url', 'https://provider.example.com/v1']);
  assert.equal(defaultResult.stdout, `${buildDynamicProxyBaseUrl('https://provider.example.com/v1')}\n`);
  assert.equal(defaultResult.stderr, '');

  const customResult = await run(process.execPath, [cli, 'url', 'https://provider.example.com/gateway', '--proxy-url', 'http://127.0.0.1:2048']);
  assert.equal(customResult.stdout, `${buildDynamicProxyBaseUrl('https://provider.example.com/gateway', 'http://127.0.0.1:2048')}\n`);
  await assert.rejects(
    run(process.execPath, [cli, 'url', 'file:///tmp/provider']),
    (error: unknown) => error instanceof Error && 'stderr' in error && /must use http or https/.test(String(error.stderr)),
  );
});

test('Insights CLI exposes list, latest report, compare, and evidence in stable JSON', async (t) => {
  const server = insightsServer();
  const port = await listen(server);
  t.after(() => close(server));
  const prismUrl = `http://127.0.0.1:${port}`;
  const options = { env: { ...process.env, PROMPT_PRISM_URL: 'http://127.0.0.1:1' } };

  const listed = await run(process.execPath, [cli, 'insights', 'list', '--prism-url', prismUrl, '--json'], options);
  assert.equal(JSON.parse(listed.stdout).runs[0].run_id, 'run-one');
  const latest = await run(process.execPath, [cli, 'insights', 'report', '--prism-url', prismUrl, '--json'], options);
  assert.equal(JSON.parse(latest.stdout).run.run_id, 'run-one');
  const compared = await run(process.execPath, [cli, 'insights', 'compare', 'run-one', 'run-one', '--prism-url', prismUrl, '--json'], options);
  assert.equal(JSON.parse(compared.stdout).metrics.calls.absolute, 0);
  const evidence = await run(process.execPath, [cli, 'insights', 'evidence', 'capture-one', '--section', 'tool-events', '--max-bytes', '128KB', '--prism-url', prismUrl, '--json'], options);
  assert.equal(JSON.parse(evidence.stdout).content, '{"name":"read"}');
});

test('Insights CLI prints readable output and structured JSON errors with non-zero status', async (t) => {
  const server = insightsServer();
  const port = await listen(server);
  t.after(() => close(server));
  const prismUrl = `http://127.0.0.1:${port}`;
  const human = await run(process.execPath, [cli, 'insights', 'report', 'run-one', '--prism-url', prismUrl]);
  assert.match(human.stdout, /Calls: 2/);
  assert.match(human.stdout, /31% cache hit/);

  await assert.rejects(
    run(process.execPath, [cli, 'insights', 'report', 'missing', '--prism-url', prismUrl, '--json']),
    (error: unknown) => {
      if (!(error instanceof Error) || !('stderr' in error)) return false;
      const value = JSON.parse(String(error.stderr));
      return value.error.code === 'run_not_found' && value.error.message === 'Run not found';
    },
  );
  await assert.rejects(
    run(process.execPath, [cli, 'insights', 'list', '--limit', '0', '--json']),
    (error: unknown) => error instanceof Error && 'stderr' in error && JSON.parse(String(error.stderr)).error.code === 'invalid_argument',
  );
});

test('CLI rejects unknown API formats before starting', async () => {
  await assert.rejects(
    run(process.execPath, [cli, 'start', '--api-format', 'unknown', '--no-open']),
    (error: unknown) => error instanceof Error && 'stderr' in error
      && /Unsupported API format: unknown/.test(String(error.stderr))
      && /Available formats: auto, anthropic-messages/.test(String(error.stderr))
  );
});

test('CLI reads and validates --upstream-url', async () => {
  await assert.rejects(
    run(process.execPath, [cli, 'start', '--upstream-url', 'file:///tmp/messages', '--no-open']),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 1 && 'stderr' in error && /Upstream URL must use http or https/.test(String(error.stderr))
  );
});

test('CLI rejects simultaneous base and exact upstream options', async () => {
  await assert.rejects(
    run(process.execPath, [cli, 'start', '--upstream-base-url', 'https://api.deepseek.com', '--upstream-url', 'https://api.deepseek.com/chat/completions', '--no-open']),
    (error: unknown) => error instanceof Error && 'stderr' in error && /mutually exclusive/.test(String(error.stderr))
  );
});
