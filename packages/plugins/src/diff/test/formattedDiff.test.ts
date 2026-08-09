import { describe, expect, it } from 'vitest';
import { buildFormattedDiff, expandJsonStringNewlines, formatDiffText, reconstructDiff } from '../dashboard/formattedDiff.js';

describe('formatted JSON diff', () => {
  it('reconstructs old and new text from stored character operations', () => {
    expect(reconstructDiff([
      { type: 'equal', value: '{"value":' }, { type: 'delete', value: '1' },
      { type: 'insert', value: '2' }, { type: 'equal', value: '}' },
    ])).toEqual({ oldText: '{"value":1}', newText: '{"value":2}' });
  });

  it('pretty prints nested JSON with two-space indentation', () => {
    expect(formatDiffText('{"messages":[{"role":"user","content":"hello"}]}')).toContain('\n  "messages": [');
  });

  it('expands newlines with continuation indentation and keeps literal backslash-n', () => {
    expect(formatDiffText('{"content":"one\\ntwo\\r\\nthree\\rfour"}')).toBe([
      '{', '  "content": "one', '              two', '              three', '              four"', '}',
    ].join('\n'));
    expect(expandJsonStringNewlines('  "content": "literal\\\\nvalue"')).toBe('  "content": "literal\\\\nvalue"');
  });

  it('produces unified rows with dual line numbers and inline changes', () => {
    const rows = buildFormattedDiff([
      { type: 'equal', value: '{"content":"hello ' }, { type: 'delete', value: 'old' },
      { type: 'insert', value: 'new' }, { type: 'equal', value: '\\nworld"}' },
    ], true);
    expect(rows.find((row) => row.type === 'delete')).toMatchObject({ oldLineNumber: 2, newLineNumber: null });
    expect(rows.find((row) => row.type === 'insert')).toMatchObject({ oldLineNumber: null, newLineNumber: 2 });
  });

  it('numbers a baseline only on the new side and falls back for invalid JSON', () => {
    expect(buildFormattedDiff([{ type: 'insert', value: 'first\nsecond' }], false)).toEqual([
      { oldLineNumber: null, newLineNumber: 1, type: 'equal', parts: [{ type: 'equal', value: 'first' }] },
      { oldLineNumber: null, newLineNumber: 2, type: 'equal', parts: [{ type: 'equal', value: 'second' }] },
    ]);
  });
});
