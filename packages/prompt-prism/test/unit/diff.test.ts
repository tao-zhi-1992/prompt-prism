import test from 'node:test';
import assert from 'node:assert/strict';
import { diffCharacters, divergencePoint } from '../../src/diff.js';
import type { DiffPart } from '../../src/types.js';

function apply(parts: DiffPart[]): { old: string; next: string } {
  return {
    old: parts.filter((part) => part.type !== 'insert').map((part) => part.value).join(''),
    next: parts.filter((part) => part.type !== 'delete').map((part) => part.value).join('')
  };
}

test('character diff reports a middle replacement exactly', () => {
  const oldText = 'The quick brown fox';
  const newText = 'The quick green fox';
  const parts = diffCharacters(oldText, newText);
  assert.deepEqual(apply(parts), { old: oldText, next: newText });
  assert.equal(divergencePoint(oldText, newText), 10);
  assert.ok(parts.some((part) => part.type === 'delete'));
  assert.ok(parts.some((part) => part.type === 'insert'));
});

test('diff handles unicode by code point', () => {
  const parts = diffCharacters('你好🙂', '你好世界🙂');
  assert.deepEqual(apply(parts), { old: '你好🙂', next: '你好世界🙂' });
  assert.equal(divergencePoint('你好🙂', '你好世界🙂'), 2);
});
