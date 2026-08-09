import { describe, expect, it } from 'vitest';
import { buildFormattedDiff, expandJsonStringNewlines, formatDiffText, reconstructDiff } from './formattedDiff';

describe('formatted JSON diff', () => {
  it('reconstructs old and new text from stored character operations', () => {
    expect(reconstructDiff([
      { type: 'equal', value: '{"value":' },
      { type: 'delete', value: '1' },
      { type: 'insert', value: '2' },
      { type: 'equal', value: '}' },
    ])).toEqual({ oldText: '{"value":1}', newText: '{"value":2}' });
  });

  it('pretty prints nested JSON with two-space indentation', () => {
    expect(formatDiffText('{"messages":[{"role":"user","content":"hello"}]}')).toBe([
      '{',
      '  "messages": [',
      '    {',
      '      "role": "user",',
      '      "content": "hello"',
      '    }',
      '  ]',
      '}',
    ].join('\n'));
  });

  it('expands LF, CRLF, and CR string escapes with continuation indentation', () => {
    expect(formatDiffText('{"content":"one\\ntwo\\r\\nthree\\rfour"}')).toBe([
      '{',
      '  "content": "one',
      '              two',
      '              three',
      '              four"',
      '}',
    ].join('\n'));
  });

  it('keeps a literal backslash-n sequence escaped', () => {
    expect(expandJsonStringNewlines('  "content": "literal\\\\nvalue"')).toBe('  "content": "literal\\\\nvalue"');
  });

  it('keeps escaped quotes inside the string while expanding later newlines', () => {
    expect(formatDiffText('{"content":"say \\"hello\\"\\nnext"}')).toBe([
      '{',
      '  "content": "say \\"hello\\"',
      '              next"',
      '}',
    ].join('\n'));
  });

  it('produces unified rows with old and new line numbers and inline character changes', () => {
    const rows = buildFormattedDiff([
      { type: 'equal', value: '{"content":"hello ' },
      { type: 'delete', value: 'old' },
      { type: 'insert', value: 'new' },
      { type: 'equal', value: '\\nworld"}' },
    ], true);
    const deleted = rows.find((row) => row.type === 'delete')!;
    const inserted = rows.find((row) => row.type === 'insert')!;
    expect(deleted.oldLineNumber).toBe(2);
    expect(deleted.newLineNumber).toBeNull();
    expect(inserted.oldLineNumber).toBeNull();
    expect(inserted.newLineNumber).toBe(2);
    expect(deleted.parts.some((part) => part.type === 'delete' && part.value === 'old')).toBe(true);
    expect(inserted.parts.some((part) => part.type === 'insert' && part.value === 'new')).toBe(true);
    expect(rows.at(-1)).toMatchObject({ oldLineNumber: 4, newLineNumber: 4, type: 'equal' });
  });

  it('numbers a baseline only on the new side and falls back for invalid JSON', () => {
    expect(buildFormattedDiff([{ type: 'insert', value: 'first\nsecond' }], false)).toEqual([
      { oldLineNumber: null, newLineNumber: 1, type: 'equal', parts: [{ type: 'equal', value: 'first' }] },
      { oldLineNumber: null, newLineNumber: 2, type: 'equal', parts: [{ type: 'equal', value: 'second' }] },
    ]);
  });
});
