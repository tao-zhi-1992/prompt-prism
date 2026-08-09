import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Analyzer } from '../server/analyzer.js';
import { diffCharacters, divergencePoint, type DiffPart } from '../server/diff.js';

function apply(parts: DiffPart[]) {
  return {
    old: parts.filter((part) => part.type !== 'insert').map((part) => part.value).join(''),
    next: parts.filter((part) => part.type !== 'delete').map((part) => part.value).join(''),
  };
}

describe('Diff server plugin', () => {
  it('matches parents and records reconstructable analysis', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-analyzer-'));
    const analyzer = new Analyzer({ analysisPath: path.join(dir, 'analysis.jsonl') });
    await analyzer.init();
    await analyzer.analyze({ id: 'one', timestamp: new Date().toISOString(), token_hash: 't', model: null, messages: [{ role: 'user', content: 'alpha beta' }], usage: {} });
    const result = await analyzer.analyze({ id: 'two', timestamp: new Date().toISOString(), token_hash: 't', model: null, messages: [{ role: 'user', content: 'alpha zeta' }], usage: {} });
    expect(result.matched_parent_id).toBe('one');
    expect(result.diff.some((part) => part.type === 'delete')).toBe(true);
    expect(analyzer.findParent('different-token', [{ role: 'user', content: 'alpha zeta' }])).toBeNull();
  });

  it('diffs replacements and unicode by code point', () => {
    const parts = diffCharacters('The quick brown fox', 'The quick green fox');
    expect(apply(parts)).toEqual({ old: 'The quick brown fox', next: 'The quick green fox' });
    expect(divergencePoint('The quick brown fox', 'The quick green fox')).toBe(10);
    expect(divergencePoint('你好🙂', '你好世界🙂')).toBe(2);
  });
});
