import { parseArgs } from 'node:util';
import type { InsightComparison, InsightEvidence, InsightReport, InsightRunSummary } from './types.js';

const DEFAULT_PRISM_URL = 'http://127.0.0.1:8787';

type RunsResponse = { schema_version: 1; runs: InsightRunSummary[] };

class InsightsCliError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function usage(): void {
  console.log(`Prompt Prism Insights

Usage:
  pp insights list [--limit NUMBER] [--prism-url URL] [--json]
  pp insights report [RUN_ID] [--prism-url URL] [--json]
  pp insights compare BASELINE_RUN_ID CANDIDATE_RUN_ID [--prism-url URL] [--json]
  pp insights evidence CAPTURE_ID --section SECTION [--max-bytes SIZE] [--prism-url URL] [--json]

Environment:
  PROMPT_PRISM_URL  Prism URL (default: ${DEFAULT_PRISM_URL})`);
}

function prismUrl(value: string | undefined): URL {
  let parsed: URL;
  try { parsed = new URL(value ?? process.env.PROMPT_PRISM_URL ?? DEFAULT_PRISM_URL); }
  catch { throw new InsightsCliError('invalid_prism_url', 'Prism URL must be a valid absolute URL'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new InsightsCliError('invalid_prism_url', 'Prism URL must use http or https');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new InsightsCliError('invalid_prism_url', 'Prism URL cannot contain credentials, query, or fragment');
  return parsed;
}

function endpoint(base: URL, pathname: string): URL {
  const url = new URL(base.href);
  url.pathname = pathname;
  url.search = '';
  url.hash = '';
  return url;
}

async function getJson<T>(url: URL): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { headers: { accept: 'application/json' } }); }
  catch (error: unknown) {
    throw new InsightsCliError('prism_unreachable', `Unable to connect to Prompt Prism at ${url.origin}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let value: unknown;
  try { value = await response.json(); }
  catch { throw new InsightsCliError('invalid_response', `Prompt Prism returned a non-JSON response (${response.status})`); }
  if (!response.ok) {
    const item = value as { code?: unknown; error?: unknown };
    throw new InsightsCliError(typeof item.code === 'string' ? item.code : 'request_failed', typeof item.error === 'string' ? item.error : `Request failed with ${response.status}`);
  }
  return value as T;
}

function formatNumber(value: number | null): string { return value === null ? '—' : new Intl.NumberFormat().format(Math.round(value)); }
function formatRate(value: number | null): string { return value === null ? '—' : `${Math.round(value * 100)}%`; }
function formatDelta(value: { absolute: number | null; percent: number | null }): string {
  if (value.absolute === null) return '—';
  const sign = value.absolute > 0 ? '+' : '';
  const percent = value.percent === null ? '' : ` (${value.percent > 0 ? '+' : ''}${Math.round(value.percent * 100)}%)`;
  return `${sign}${formatNumber(value.absolute)}${percent}`;
}

function parseEvidenceBytes(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb)?$/i);
  if (!match) throw new InsightsCliError('invalid_argument', 'max-bytes must be a byte count or use KB/MB');
  const units = { b: 1, kb: 1024, mb: 1024 ** 2 } as const;
  const bytes = Math.floor(Number(match[1]) * units[(match[2] ?? 'b').toLowerCase() as keyof typeof units]);
  if (bytes < 1 || bytes > 10 * 1024 * 1024) throw new InsightsCliError('invalid_argument', 'max-bytes must be between 1 byte and 10MB');
  return bytes;
}

function printRuns(runs: InsightRunSummary[]): void {
  if (!runs.length) { console.log('No captured runs.'); return; }
  console.log('RUN ID\tCOMPLETED\tCALLS\tINPUT\tOUTPUT\tCACHE HIT\tSTATUS');
  for (const run of runs) console.log([
    run.run_id,
    run.completed_at,
    run.calls,
    run.tokens.input_total_tokens,
    run.tokens.output_tokens,
    formatRate(run.tokens.cache_hit_rate),
    run.status,
  ].join('\t'));
}

function printReport(report: InsightReport): void {
  const { run } = report;
  console.log(`Run ${run.run_id}${run.trace_id ? ` (${run.trace_id})` : ''}`);
  console.log(`Calls: ${run.calls}  Status: ${run.status}  Models: ${run.models.join(', ') || '—'}`);
  console.log(`Tokens: ${formatNumber(run.tokens.input_total_tokens)} input · ${formatNumber(run.tokens.output_tokens)} output · ${formatRate(run.tokens.cache_hit_rate)} cache hit`);
  console.log(`Timing: ${formatNumber(run.timing.trace_span_ms)} ms span · ${formatNumber(run.timing.model_duration_ms)} ms model · ${formatNumber(run.timing.average_time_to_first_byte_ms)} ms avg first byte`);
  console.log(`Tools: ${report.tools.calls} calls · ${report.tools.errors} errors · ${report.tools.repeated_calls} repeated · ${formatNumber(report.tools.result_bytes)} result bytes`);
  if (!report.findings.length) console.log('Findings: none');
  else {
    console.log('Findings:');
    for (const item of report.findings) console.log(`  [${item.severity}] ${item.code}: ${item.summary}\n    ${item.recommendation}`);
  }
}

function printComparison(comparison: InsightComparison): void {
  console.log(`Baseline ${comparison.baseline.run_id}`);
  console.log(`Candidate ${comparison.candidate.run_id}`);
  console.log('METRIC\tBEFORE\tAFTER\tDELTA');
  for (const [name, item] of Object.entries(comparison.metrics)) console.log(`${name}\t${formatNumber(item.before)}\t${formatNumber(item.after)}\t${formatDelta(item)}`);
  console.log(`Findings: ${comparison.findings.added.length} added · ${comparison.findings.resolved.length} resolved · ${comparison.findings.persisting.length} persisting`);
}

function commonOptions() {
  return {
    'prism-url': { type: 'string' as const },
    json: { type: 'boolean' as const, default: false },
    help: { type: 'boolean' as const, short: 'h' },
  };
}

async function execute(args: string[]): Promise<void> {
  const action = args[0];
  if (!action || action === 'help' || action === '--help' || action === '-h') { usage(); return; }
  if (action === 'list') {
    const { values, positionals } = parseArgs({ args: args.slice(1), options: { ...commonOptions(), limit: { type: 'string', default: '20' } }, allowPositionals: true });
    if (values.help) { usage(); return; }
    if (positionals.length) throw new InsightsCliError('invalid_argument', 'list does not accept positional arguments');
    const limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new InsightsCliError('invalid_argument', 'limit must be between 1 and 100');
    const url = endpoint(prismUrl(values['prism-url']), '/_pp/api/insights/runs');
    url.searchParams.set('limit', String(limit));
    const result = await getJson<RunsResponse>(url);
    if (values.json) console.log(JSON.stringify(result, null, 2)); else printRuns(result.runs);
    return;
  }
  if (action === 'report') {
    const { values, positionals } = parseArgs({ args: args.slice(1), options: commonOptions(), allowPositionals: true });
    if (values.help) { usage(); return; }
    if (positionals.length > 1) throw new InsightsCliError('invalid_argument', 'report accepts at most one RUN_ID');
    const base = prismUrl(values['prism-url']);
    let runId = positionals[0];
    if (!runId) {
      const latest = endpoint(base, '/_pp/api/insights/runs');
      latest.searchParams.set('limit', '1');
      runId = (await getJson<RunsResponse>(latest)).runs[0]?.run_id;
      if (!runId) throw new InsightsCliError('run_not_found', 'No captured runs');
    }
    const result = await getJson<InsightReport>(endpoint(base, `/_pp/api/insights/report/${encodeURIComponent(runId)}`));
    if (values.json) console.log(JSON.stringify(result, null, 2)); else printReport(result);
    return;
  }
  if (action === 'compare') {
    const { values, positionals } = parseArgs({ args: args.slice(1), options: commonOptions(), allowPositionals: true });
    if (values.help) { usage(); return; }
    if (positionals.length !== 2) throw new InsightsCliError('invalid_argument', 'compare requires BASELINE_RUN_ID and CANDIDATE_RUN_ID');
    const url = endpoint(prismUrl(values['prism-url']), '/_pp/api/insights/compare');
    url.searchParams.set('baseline', positionals[0]!);
    url.searchParams.set('candidate', positionals[1]!);
    const result = await getJson<InsightComparison>(url);
    if (values.json) console.log(JSON.stringify(result, null, 2)); else printComparison(result);
    return;
  }
  if (action === 'evidence') {
    const { values, positionals } = parseArgs({
      args: args.slice(1),
      options: { ...commonOptions(), section: { type: 'string' }, 'max-bytes': { type: 'string', default: String(64 * 1024) } },
      allowPositionals: true,
    });
    if (values.help) { usage(); return; }
    if (positionals.length !== 1 || !values.section) throw new InsightsCliError('invalid_argument', 'evidence requires CAPTURE_ID and --section SECTION');
    const maxBytes = parseEvidenceBytes(values['max-bytes']);
    const url = endpoint(prismUrl(values['prism-url']), `/_pp/api/insights/evidence/${encodeURIComponent(positionals[0]!)}`);
    url.searchParams.set('section', values.section);
    url.searchParams.set('max_bytes', String(maxBytes));
    const result = await getJson<InsightEvidence>(url);
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.capture_id} · ${result.section} · ${result.returned_bytes}/${result.original_bytes} bytes${result.truncated ? ' (truncated)' : ''}`);
      console.log(result.content);
    }
    return;
  }
  throw new InsightsCliError('unknown_command', `Unknown insights command: ${action}`);
}

export async function runInsightsCli(args: string[]): Promise<void> {
  const json = args.includes('--json');
  try { await execute(args); }
  catch (error: unknown) {
    const parseError = error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS');
    const item = error instanceof InsightsCliError ? error : new InsightsCliError(parseError ? 'invalid_argument' : 'unexpected_error', error instanceof Error ? error.message : String(error));
    if (json) console.error(JSON.stringify({ schema_version: 1, error: { code: item.code, message: item.message } }));
    else console.error(`pp insights: ${item.message}`);
    process.exitCode = 1;
  }
}
