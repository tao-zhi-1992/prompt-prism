import { appendFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { InputDiffAnalyzer } from '../server/analyzer.js';
import { createInputDiffServerPlugin } from '../server/index.js';
import { diffCharacters, divergencePoint, type DiffPart } from '../server/diff.js';
import type { JsonValue, Message, ModelInputSnapshot, ServerPluginContext } from '@prompt-prism/contracts/server';

function apply(parts: DiffPart[]) {
  return {
    old: parts.filter((part) => part.type !== 'insert').map((part) => part.value).join(''),
    next: parts.filter((part) => part.type !== 'delete').map((part) => part.value).join(''),
  };
}

describe('Input Diff server plugin', () => {
  const capture = (id: string, timestamp: string, messages: Message[], overrides = {}) => ({
    id, timestamp, token_hash: 't', upstream_host: 'provider.example.com', model: 'model', messages, usage: {}, ...overrides,
  });

  const input = (messages: Message[], system: string, tools: JsonValue[], maxTokens: number, primarySequence: JsonValue[] = messages): ModelInputSnapshot => ({
    adapter_id: 'anthropic',
    primary_section_id: 'messages',
    primary_sequence: primarySequence,
    sections: [
      { id: 'messages', label: 'Messages', order: 10, value: messages, compare_as: 'sequence', default_collapsed: false },
      { id: 'system', label: 'System', order: 20, value: system, compare_as: 'json', default_collapsed: true },
      { id: 'tools', label: 'Tools', order: 30, value: tools, compare_as: 'json', default_collapsed: true },
      { id: 'options', label: 'Request options', order: 40, value: { model: 'model', max_tokens: maxTokens }, compare_as: 'json', default_collapsed: true },
    ],
  });

  it('uses the supplied Trace parent and records sectioned, reconstructable analysis', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-analyzer-'));
    const analyzer = new InputDiffAnalyzer({ analysisPath: path.join(dir, 'analysis.jsonl') });
    await analyzer.init();
    const parent = capture('one', '2026-01-01T00:00:00.000Z', [{ role: 'user', content: 'same' }, { role: 'assistant', content: 'old' }]);
    const result = await analyzer.analyze(capture('two', '2026-01-02T00:00:00.000Z', [{ role: 'user', content: 'same' }, { role: 'assistant', content: 'new' }]), undefined, { ...parent, file_ref: 'one.json' });
    expect(result.matched_parent_id).toBe('one');
    expect(result.diff.some((part) => part.type === 'delete')).toBe(true);
    expect(result.sections?.map(({ id }) => id)).toEqual(['messages']);
  });

  it('diffs all normalized input sections against the supplied Trace parent', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-input-diff-'));
    const analyzer = new InputDiffAnalyzer({ analysisPath: path.join(dir, 'analysis.jsonl') });
    await analyzer.init();
    const messages = [{ role: 'user', content: 'same' }];
    const tools = [{ name: 'search' }];
    const parent = capture('newest', '2026-01-02T00:00:00.000Z', messages, { prompt_input: input(messages, 'old system', tools, 100), adapter_id: 'anthropic' });
    const result = await analyzer.analyze(capture('current', '2026-01-03T00:00:00.000Z', messages, { prompt_input: input(messages, 'new system', tools, 200), adapter_id: 'anthropic' }), undefined, { ...parent, file_ref: 'newest.json' });

    expect(result.matched_parent_id).toBe('newest');
    expect(result.sections?.map(({ id, state }) => ({ id, state }))).toEqual([
      { id: 'messages', state: 'unchanged' },
      { id: 'system', state: 'changed' },
      { id: 'tools', state: 'unchanged' },
      { id: 'options', state: 'changed' },
    ]);
  });

  it('does not treat a legacy messages-only capture as a complete normalized parent', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-input-diff-legacy-'));
    const analyzer = new InputDiffAnalyzer({ analysisPath: path.join(dir, 'analysis.jsonl') });
    const messages = [{ role: 'user', content: 'same' }];
    await analyzer.init([{ ...capture('legacy', '2026-01-01T00:00:00.000Z', messages), file_ref: 'legacy.json' }]);
    const result = await analyzer.analyze(capture('current', '2026-01-02T00:00:00.000Z', messages, {
      adapter_id: 'anthropic', prompt_input: input(messages, 'system', [], 100),
    }));
    expect(result.matched_parent_id).toBeNull();
    expect(result.sections?.every(({ state }) => state === 'baseline' || state === 'empty')).toBe(true);
  });

  it('clears analyses before processing a new capture generation', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-input-diff-clear-'));
    const analyzer = new InputDiffAnalyzer({ analysisPath: path.join(dir, 'analysis.jsonl') });
    await analyzer.init();
    const messages = [{ role: 'user', content: 'same' }];
    await analyzer.analyze(capture('before-clear', '2026-01-01T00:00:00.000Z', messages));

    analyzer.clear();

    expect(analyzer.analyses.size).toBe(0);
    const result = await analyzer.analyze(capture('after-clear', '2026-01-02T00:00:00.000Z', messages));
    expect(result.matched_parent_id).toBeNull();
  });

  it('clears analyzer state through the plugin lifecycle hook', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-input-diff-plugin-clear-'));
    const plugin = createInputDiffServerPlugin();
    const context: ServerPluginContext = {
      analysisPath: path.join(dir, 'analysis.jsonl'), captures: [], readCapture: vi.fn(),
      parseProviderRequest: vi.fn(), parseProviderResponse: vi.fn(), json: vi.fn(), reportError: vi.fn(),
    };
    await plugin.init!(context);
    await plugin.getAnalyzer().analyze(capture('before-clear', '2026-01-01T00:00:00.000Z', [{ role: 'user', content: 'same' }]));

    await plugin.onClear!(context);

    expect(plugin.getAnalyzer().analyses.size).toBe(0);
  });

  it('repairs an incomplete analysis tail and removes analyses for missing captures', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-input-diff-recovery-'));
    const analysisPath = path.join(dir, 'analysis.jsonl');
    const analyzer = new InputDiffAnalyzer({ analysisPath });
    await analyzer.init();
    const messages = [{ role: 'user', content: 'same' }];
    const staleCapture = capture('stale', '2026-01-01T00:00:00.000Z', messages);
    const validCapture = capture('valid', '2026-01-02T00:00:00.000Z', messages);
    await analyzer.analyze(staleCapture);
    await analyzer.analyze(validCapture);
    await appendFile(analysisPath, '{"id":"partial"');

    const recovered = new InputDiffAnalyzer({ analysisPath });
    await recovered.init([{ ...validCapture, file_ref: 'valid.json' }]);

    expect([...recovered.analyses.keys()]).toEqual(['valid']);
    const persisted = await readFile(analysisPath, 'utf8');
    expect(persisted.trim().split('\n').map((line) => JSON.parse(line).id)).toEqual(['valid']);
  });

  it('compacts duplicate analysis records while retaining the latest value', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-input-diff-duplicate-'));
    const analysisPath = path.join(dir, 'analysis.jsonl');
    const analyzer = new InputDiffAnalyzer({ analysisPath });
    await analyzer.init();
    const messages = [{ role: 'user', content: 'same' }];
    const stored = { ...capture('duplicate', '2026-01-01T00:00:00.000Z', messages), file_ref: 'duplicate.json' };
    await analyzer.analyze(stored, stored);
    await analyzer.analyze({ ...stored, timestamp: '2026-01-02T00:00:00.000Z' }, stored);

    const recovered = new InputDiffAnalyzer({ analysisPath });
    await recovered.init([stored]);

    expect(recovered.analyses.get('duplicate')?.timestamp).toBe('2026-01-02T00:00:00.000Z');
    expect((await readFile(analysisPath, 'utf8')).trim().split('\n')).toHaveLength(1);
  });

  it('rejects corruption before the incomplete tail of the analysis log', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-input-diff-corrupt-'));
    const analysisPath = path.join(dir, 'analysis.jsonl');
    await writeFile(analysisPath, '{bad}\n{"id":"partial"');

    await expect(new InputDiffAnalyzer({ analysisPath }).init()).rejects.toThrow('Invalid analysis record at line 1');
  });

  it('rejects syntactically valid analysis records with missing fields', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-input-diff-invalid-'));
    const analysisPath = path.join(dir, 'analysis.jsonl');
    await writeFile(analysisPath, '{"id":"incomplete"}');

    await expect(new InputDiffAnalyzer({ analysisPath }).init()).rejects.toThrow('Invalid analysis record at line 1');
  });

  it('matches normalized primary items while preserving cache-control changes in the visible diff', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-input-diff-cache-control-'));
    const analyzer = new InputDiffAnalyzer({ analysisPath: path.join(dir, 'analysis.jsonl') });
    await analyzer.init();
    const oldMessages: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'same', cache_control: { type: 'ephemeral' } }] }];
    const newMessages: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'same' }] }];
    const identity = [{ role: 'user', content: [{ type: 'text', text: 'same' }] }];
    const parent = capture('old', '2026-01-01T00:00:00.000Z', oldMessages, {
      adapter_id: 'anthropic', prompt_input: input(oldMessages, 'system', [], 100, identity),
    });
    const result = await analyzer.analyze(capture('current', '2026-01-02T00:00:00.000Z', newMessages, {
      adapter_id: 'anthropic', prompt_input: input(newMessages, 'system', [], 100, identity),
    }), undefined, { ...parent, file_ref: 'old.json' });
    expect(result.matched_parent_id).toBe('old');
    expect(result.sections?.find(({ id }) => id === 'messages')?.state).toBe('changed');
    expect(result.diff.some(({ type, value }) => type === 'delete' && value.includes('cache_control'))).toBe(true);
  });

  it('diffs replacements and unicode by code point', () => {
    const parts = diffCharacters('The quick brown fox', 'The quick green fox');
    expect(apply(parts)).toEqual({ old: 'The quick brown fox', next: 'The quick green fox' });
    expect(divergencePoint('The quick brown fox', 'The quick green fox')).toBe(10);
    expect(divergencePoint('你好🙂', '你好世界🙂')).toBe(2);
  });

  it('handles large inputs without allocating a quadratic diff matrix', () => {
    const left = `${'x'.repeat(100_000)}old`;
    const right = `${'x'.repeat(100_000)}new`;
    const parts = diffCharacters(left, right);

    expect(apply(parts)).toEqual({ old: left, next: right });
    expect(parts.slice(-2)).toEqual([
      { type: 'delete', value: 'old' },
      { type: 'insert', value: 'new' },
    ]);
  });
});
