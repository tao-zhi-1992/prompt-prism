import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InputDiffAnalyzer } from '../server/analyzer.js';
import { diffCharacters, divergencePoint, type DiffPart } from '../server/diff.js';
import type { JsonValue, Message, ModelInputSnapshot } from '../../contracts/server.js';

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

  it('matches a related parent and records sectioned, reconstructable analysis', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-analyzer-'));
    const analyzer = new InputDiffAnalyzer({ analysisPath: path.join(dir, 'analysis.jsonl') });
    await analyzer.init();
    await analyzer.analyze(capture('one', '2026-01-01T00:00:00.000Z', [{ role: 'user', content: 'same' }, { role: 'assistant', content: 'old' }]));
    const result = await analyzer.analyze(capture('two', '2026-01-02T00:00:00.000Z', [{ role: 'user', content: 'same' }, { role: 'assistant', content: 'new' }]));
    expect(result.matched_parent_id).toBe('one');
    expect(result.diff.some((part) => part.type === 'delete')).toBe(true);
    expect(result.sections?.map(({ id }) => id)).toEqual(['messages']);
    expect(analyzer.findParent(capture('unrelated', '2026-01-03T00:00:00.000Z', [{ role: 'user', content: 'different' }]))).toBeNull();
    expect(analyzer.findParent(capture('other-host', '2026-01-03T00:00:00.000Z', [{ role: 'user', content: 'same' }], { upstream_host: 'other.example.com' }))).toBeNull();
  });

  it('diffs all normalized input sections and chooses the newest tied parent', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-input-diff-'));
    const analyzer = new InputDiffAnalyzer({ analysisPath: path.join(dir, 'analysis.jsonl') });
    await analyzer.init();
    const messages = [{ role: 'user', content: 'same' }];
    const tools = [{ name: 'search' }];
    await analyzer.analyze(capture('oldest', '2026-01-01T00:00:00.000Z', messages, { prompt_input: input(messages, 'old system', tools, 100), adapter_id: 'anthropic' }));
    await analyzer.analyze(capture('newest', '2026-01-02T00:00:00.000Z', messages, { prompt_input: input(messages, 'old system', tools, 100), adapter_id: 'anthropic' }));
    const result = await analyzer.analyze(capture('current', '2026-01-03T00:00:00.000Z', messages, { prompt_input: input(messages, 'new system', tools, 200), adapter_id: 'anthropic' }));

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

  it('matches normalized primary items while preserving cache-control changes in the visible diff', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-input-diff-cache-control-'));
    const analyzer = new InputDiffAnalyzer({ analysisPath: path.join(dir, 'analysis.jsonl') });
    await analyzer.init();
    const oldMessages: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'same', cache_control: { type: 'ephemeral' } }] }];
    const newMessages: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'same' }] }];
    const identity = [{ role: 'user', content: [{ type: 'text', text: 'same' }] }];
    await analyzer.analyze(capture('old', '2026-01-01T00:00:00.000Z', oldMessages, {
      adapter_id: 'anthropic', prompt_input: input(oldMessages, 'system', [], 100, identity),
    }));
    const result = await analyzer.analyze(capture('current', '2026-01-02T00:00:00.000Z', newMessages, {
      adapter_id: 'anthropic', prompt_input: input(newMessages, 'system', [], 100, identity),
    }));
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
