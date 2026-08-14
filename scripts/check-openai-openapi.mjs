#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const revision = process.argv.slice(2).find((value) => value !== '--');
if (!revision || !/^[0-9a-f]{40}$/i.test(revision)) {
  process.stderr.write('Usage: node scripts/check-openai-openapi.mjs <40-character-openai-openapi-commit>\n');
  process.exitCode = 2;
} else {
  const workspace = await mkdtemp(path.join(tmpdir(), 'prompt-prism-openapi-'));
  try {
    const url = `https://raw.githubusercontent.com/openai/openai-openapi/${revision}/openapi.json`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`OpenAI OpenAPI download failed: HTTP ${response.status}`);
    const text = await response.text();
    const spec = JSON.parse(text);
    await writeFile(path.join(workspace, 'openapi.json'), text);
    const fixtureSources = JSON.parse(await readFile('packages/core/test/fixtures/protocols/sources.json', 'utf8'));
    const paths = spec.paths ?? {};
    const expected = [
      ['openai-chat-completions', '/v1/chat/completions', '/chat/completions'],
      ['openai-responses', '/v1/responses', '/responses'],
    ];
    const results = expected.map(([id, endpoint, specEndpoint]) => ({
      id, endpoint, endpoint_in_download: Boolean(paths[endpoint]),
      spec_endpoint: specEndpoint,
      spec_endpoint_in_download: Boolean(paths[specEndpoint]),
      fixture_endpoint: fixtureSources.fixtures[id]?.endpoint ?? null,
      fixture_revision: fixtureSources.fixtures[id]?.sources.find((source) => source.revision)?.revision ?? null,
    }));
    process.stdout.write(`${JSON.stringify({ revision, bytes: Buffer.byteLength(text), results }, null, 2)}\n`);
    if (results.some((result) => !result.spec_endpoint_in_download || result.fixture_endpoint !== result.endpoint)) process.exitCode = 1;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
