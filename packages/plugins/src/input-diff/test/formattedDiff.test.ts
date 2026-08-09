import { describe, expect, it } from 'vitest';
import { buildFormattedDiff, expandJsonStringNewlines, formatDiffText, reconstructDiff } from '../dashboard/formattedDiff.js';

describe('formatted Input Diff', () => {
  const replace = (oldValue: unknown, newValue: unknown) => [
    { type: 'delete' as const, value: JSON.stringify(oldValue) },
    { type: 'insert' as const, value: JSON.stringify(newValue) },
  ];
  const text = (row: { parts: Array<{ value: string }> }) => row.parts.map((part) => part.value).join('');

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

  it('keeps unchanged message text neutral when cache_control moves', () => {
    const oldValue = [{ role: 'user', content: [{ type: 'text', text: '真的吗', cache_control: { type: 'ephemeral' } }] }];
    const newValue = [
      { role: 'user', content: [{ type: 'text', text: '真的吗' }] },
      { role: 'assistant', content: [{ type: 'text', text: '真的' }] },
      { role: 'user', content: [{ type: 'text', text: '继续', cache_control: { type: 'ephemeral' } }] },
    ];
    const rows = buildFormattedDiff(replace(oldValue, newValue), true);
    const originalText = rows.find((candidate) => text(candidate).includes('"text": "真的吗"'));
    expect(originalText?.type).toBe('equal');
    expect(originalText?.parts.every((part) => part.type === 'equal')).toBe(true);
    expect(rows.some((candidate) => candidate.type === 'delete' && text(candidate).includes('"cache_control": {'))).toBe(true);
    expect(rows.some((candidate) => candidate.type === 'insert' && text(candidate).includes('"cache_control": {'))).toBe(true);
    expect(rows.some((candidate) => candidate.type === 'insert' && text(candidate).includes('"role": "assistant"'))).toBe(true);
  });

  it('aligns unchanged array elements around a middle insertion', () => {
    const rows = buildFormattedDiff(replace([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'x' }, { id: 'b' }]), true);
    expect(rows.find((candidate) => text(candidate).includes('"id": "a"'))?.type).toBe('equal');
    expect(rows.find((candidate) => text(candidate).includes('"id": "x"'))?.type).toBe('insert');
    expect(rows.find((candidate) => text(candidate).includes('"id": "b"'))?.type).toBe('equal');
  });

  it('aligns unchanged array elements around a deletion', () => {
    const rows = buildFormattedDiff(replace([{ id: 'a' }, { id: 'drop' }, { id: 'c' }], [{ id: 'a' }, { id: 'c' }]), true);
    expect(rows.find((candidate) => text(candidate).includes('"id": "drop"'))?.type).toBe('delete');
    expect(rows.find((candidate) => text(candidate).includes('"id": "c"'))?.type).toBe('equal');
  });

  it('diffs changed scalar values inline while keeping shared containers neutral', () => {
    const rows = buildFormattedDiff(replace({ prompt: 'hello old' }, { prompt: 'hello new' }), true);
    const removed = rows.find((candidate) => candidate.type === 'delete')!;
    const added = rows.find((candidate) => candidate.type === 'insert')!;
    expect(text(removed)).toContain('hello old');
    expect(removed.parts.some((part) => part.type === 'delete' && part.value === 'old')).toBe(true);
    expect(added.parts.some((part) => part.type === 'insert' && part.value === 'new')).toBe(true);
    expect(rows.filter((candidate) => ['{', '}'].includes(text(candidate).trim())).every((candidate) => candidate.type === 'equal')).toBe(true);
  });

  it('colors every line of a wholly inserted or deleted subtree', () => {
    const rows = buildFormattedDiff(replace({ removed: { nested: [] } }, { added: { nested: [] } }), true);
    const removedRows = rows.filter((candidate) => candidate.type === 'delete');
    const insertedRows = rows.filter((candidate) => candidate.type === 'insert');
    expect(removedRows.map(text)).toEqual(expect.arrayContaining(['  "removed": {', '    "nested": [', '    ]', '  },']));
    expect(insertedRows.map(text)).toEqual(expect.arrayContaining(['  "added": {', '    "nested": [', '    ]', '  }']));
  });

  it.each([null, true, 42, '你好', {}, []])('renders JSON baseline value %j', (value) => {
    const rows = buildFormattedDiff([{ type: 'insert', value: JSON.stringify(value) }], false);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((candidate) => candidate.type === 'equal' && candidate.oldLineNumber === null)).toBe(true);
  });
});
