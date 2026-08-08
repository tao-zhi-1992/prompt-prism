import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Analyzer } from '../../src/analyzer.js';

test('parent matching prefers complete message prefix, then character prefix', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-analyzer-'));
  const analyzer = new Analyzer({ analysisPath: path.join(dir, 'analysis.jsonl') });
  await analyzer.init();
  analyzer.addToIndex('token', { id: 'unrelated', messages: [{ role: 'user', content: 'other' }] });
  analyzer.addToIndex('token', { id: 'parent', messages: [{ role: 'user', content: 'hello' }] });
  const current = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }];
  assert.equal(analyzer.findParent('token', current).id, 'parent');
  assert.equal(analyzer.findParent('different-token', current), null);
});

test('analysis records the first differing character and reconstructable diff', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-analyzer-'));
  const analyzer = new Analyzer({ analysisPath: path.join(dir, 'analysis.jsonl') });
  await analyzer.init();
  await analyzer.analyze({ id: 'one', timestamp: new Date().toISOString(), token_hash: 't', messages: [{ role: 'user', content: 'alpha beta' }], usage: {} });
  const result = await analyzer.analyze({ id: 'two', timestamp: new Date().toISOString(), token_hash: 't', messages: [{ role: 'user', content: 'alpha zeta' }], usage: {} });
  assert.equal(result.matched_parent_id, 'one');
  assert.ok(result.divergence_point > 0);
  assert.ok(result.diff.some((part) => part.type === 'delete'));
  assert.ok(result.diff.some((part) => part.type === 'insert'));
});
