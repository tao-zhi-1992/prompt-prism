import test from 'node:test';
import assert from 'node:assert/strict';
import { listInventory, parseLimit } from '../src/http.js';

test('accepts an explicit zero pagination limit', () => {
  assert.equal(parseLimit('0'), 0);
  assert.deepEqual(listInventory([{ id: '1', name: 'Prism', quantity: 1 }], '0'), []);
});

test('uses the default limit only when absent', () => {
  assert.equal(parseLimit(undefined), 20);
});
