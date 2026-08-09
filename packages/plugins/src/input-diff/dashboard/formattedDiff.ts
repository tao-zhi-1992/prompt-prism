import { diffArrays, diffChars } from 'diff';

export type DiffPart = { type: 'equal' | 'insert' | 'delete'; value: string };

export type FormattedInputDiffRow = {
  oldLineNumber: number | null;
  newLineNumber: number | null;
  type: 'equal' | 'delete' | 'insert';
  parts: DiffPart[];
};

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type RowType = FormattedInputDiffRow['type'];
type DraftRow = { type: RowType; parts: DiffPart[] };
type ArrayPair = { oldValue?: JsonValue; newValue?: JsonValue };

export function reconstructDiff(parts: DiffPart[]): { oldText: string; newText: string } {
  let oldText = '';
  let newText = '';
  for (const part of parts) {
    if (part.type !== 'insert') oldText += part.value;
    if (part.type !== 'delete') newText += part.value;
  }
  return { oldText, newText };
}

function append(output: { value: string }, value: string, column: { value: number }) {
  output.value += value;
  const newline = value.lastIndexOf('\n');
  column.value = newline === -1 ? column.value + value.length : value.length - newline - 1;
}

export function expandJsonStringNewlines(text: string): string {
  const output = { value: '' };
  const column = { value: 0 };
  let inString = false;
  let continuationColumn = 0;
  let index = 0;
  while (index < text.length) {
    const character = text[index]!;
    if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index++;
      append(output, '\n', column); index++; continue;
    }
    if (!inString) {
      append(output, character, column);
      if (character === '"') { inString = true; continuationColumn = column.value; }
      index++; continue;
    }
    if (character === '"') { append(output, character, column); inString = false; index++; continue; }
    if (character !== '\\') { append(output, character, column); index++; continue; }
    const slashStart = index;
    while (text[index] === '\\') index++;
    const slashCount = index - slashStart;
    const escape = text[index];
    const isNewline = slashCount % 2 === 1 && (escape === 'n' || escape === 'r');
    if (!isNewline) {
      append(output, '\\'.repeat(slashCount), column);
      if (slashCount % 2 === 1 && escape !== undefined) { append(output, escape, column); index++; }
      continue;
    }
    append(output, '\\'.repeat(slashCount - 1), column);
    index++;
    if (escape === 'r' && text[index] === '\\' && text[index + 1] === 'n') index += 2;
    append(output, `\n${' '.repeat(continuationColumn)}`, column);
  }
  return output.value;
}

export function formatDiffText(raw: string): string {
  let formatted = raw;
  try { formatted = JSON.stringify(JSON.parse(raw), null, 2); }
  catch { /* Historical or incomplete analysis falls back to raw text. */ }
  return expandJsonStringNewlines(formatted);
}

function wholeLine(value: string, type: DiffPart['type']): DiffPart[] { return value ? [{ type, value }] : []; }

function changedLineParts(oldLine: string, newLine: string): { removed: DiffPart[]; added: DiffPart[] } {
  const changes = diffChars(oldLine, newLine);
  return {
    removed: changes.filter((change) => !change.added).map((change) => ({ type: change.removed ? 'delete' : 'equal', value: change.value })),
    added: changes.filter((change) => !change.removed).map((change) => ({ type: change.added ? 'insert' : 'equal', value: change.value })),
  };
}

function textRows(oldLines: string[], newLines: string[]): DraftRow[] {
  const changes = diffArrays(oldLines, newLines);
  const rows: DraftRow[] = [];
  const deleted = (line: string, parts = wholeLine(line, 'delete')) => rows.push({ type: 'delete', parts });
  const inserted = (line: string, parts = wholeLine(line, 'insert')) => rows.push({ type: 'insert', parts });
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index]!;
    if (!change.added && !change.removed) {
      for (const line of change.value) rows.push({ type: 'equal', parts: wholeLine(line, 'equal') });
      continue;
    }
    if (change.removed && changes[index + 1]?.added) {
      const removedLines = change.value;
      const addedLines = changes[++index]!.value;
      const paired = Math.min(removedLines.length, addedLines.length);
      for (let lineIndex = 0; lineIndex < paired; lineIndex++) {
        const parts = changedLineParts(removedLines[lineIndex]!, addedLines[lineIndex]!);
        deleted(removedLines[lineIndex]!, parts.removed);
        inserted(addedLines[lineIndex]!, parts.added);
      }
      for (const line of removedLines.slice(paired)) deleted(line);
      for (const line of addedLines.slice(paired)) inserted(line);
      continue;
    }
    if (change.removed) for (const line of change.value) deleted(line);
    else for (const line of change.value) inserted(line);
  }
  return rows;
}

function jsonKind(value: JsonValue): 'array' | 'object' | 'primitive' {
  if (Array.isArray(value)) return 'array';
  if (value !== null && typeof value === 'object') return 'object';
  return 'primitive';
}

function indentation(depth: number): string { return '  '.repeat(depth); }
function propertyPrefix(key: string): string { return `${JSON.stringify(key)}: `; }
function serialized(value: JsonValue): string { return JSON.stringify(value); }

function row(type: RowType, value: string): DraftRow {
  return { type, parts: wholeLine(value, type) };
}

function appendComma(rows: DraftRow[], type: DiffPart['type'] = 'equal'): void {
  const last = rows.at(-1);
  if (last) last.parts.push({ type, value: ',' });
}

function renderScalar(value: JsonPrimitive, depth: number, prefix: string, type: RowType): DraftRow[] {
  const lines = expandJsonStringNewlines(`${indentation(depth)}${prefix}${serialized(value)}`).split('\n');
  return lines.map((line) => row(type, line));
}

function renderValue(value: JsonValue, depth: number, prefix: string, type: RowType): DraftRow[] {
  if (jsonKind(value) === 'primitive') return renderScalar(value as JsonPrimitive, depth, prefix, type);
  const array = Array.isArray(value);
  const rows = [row(type, `${indentation(depth)}${prefix}${array ? '[' : '{'}`)];
  const children = array
    ? value.map((child) => renderValue(child, depth + 1, '', type))
    : Object.entries(value as { [key: string]: JsonValue }).map(([key, child]) => renderValue(child, depth + 1, propertyPrefix(key), type));
  children.forEach((child, index) => {
    if (index < children.length - 1) appendComma(child, type);
    rows.push(...child);
  });
  rows.push(row(type, `${indentation(depth)}${array ? ']' : '}'}`));
  return rows;
}

function alignArray(oldValues: JsonValue[], newValues: JsonValue[]): ArrayPair[] {
  const changes = diffArrays(oldValues.map(serialized), newValues.map(serialized));
  const pairs: ArrayPair[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index]!;
    if (!change.added && !change.removed) {
      for (let offset = 0; offset < change.value.length; offset++) {
        pairs.push({ oldValue: oldValues[oldIndex++], newValue: newValues[newIndex++] });
      }
      continue;
    }
    if (change.removed && changes[index + 1]?.added) {
      const removedCount = change.value.length;
      const addedCount = changes[++index]!.value.length;
      const pairedCount = Math.min(removedCount, addedCount);
      for (let offset = 0; offset < pairedCount; offset++) {
        const oldValue = oldValues[oldIndex]!;
        const newValue = newValues[newIndex]!;
        if (jsonKind(oldValue) === jsonKind(newValue)) pairs.push({ oldValue, newValue });
        else pairs.push({ oldValue }, { newValue });
        oldIndex++; newIndex++;
      }
      for (let offset = pairedCount; offset < removedCount; offset++) pairs.push({ oldValue: oldValues[oldIndex++] });
      for (let offset = pairedCount; offset < addedCount; offset++) pairs.push({ newValue: newValues[newIndex++] });
      continue;
    }
    if (change.removed) {
      for (let offset = 0; offset < change.value.length; offset++) pairs.push({ oldValue: oldValues[oldIndex++] });
    } else {
      for (let offset = 0; offset < change.value.length; offset++) pairs.push({ newValue: newValues[newIndex++] });
    }
  }
  return pairs;
}

function diffScalar(oldValue: JsonPrimitive, newValue: JsonPrimitive, depth: number, prefix: string): DraftRow[] {
  const oldLines = expandJsonStringNewlines(`${indentation(depth)}${prefix}${serialized(oldValue)}`).split('\n');
  const newLines = expandJsonStringNewlines(`${indentation(depth)}${prefix}${serialized(newValue)}`).split('\n');
  return textRows(oldLines, newLines);
}

function diffObject(oldValue: { [key: string]: JsonValue }, newValue: { [key: string]: JsonValue }, depth: number, prefix: string): DraftRow[] {
  const rows = [row('equal', `${indentation(depth)}${prefix}{`)];
  const blocks: DraftRow[][] = [];
  const visited = new Set<string>();
  for (const key of Object.keys(oldValue)) {
    visited.add(key);
    if (Object.hasOwn(newValue, key)) blocks.push(diffValue(oldValue[key]!, newValue[key]!, depth + 1, propertyPrefix(key)));
    else blocks.push(renderValue(oldValue[key]!, depth + 1, propertyPrefix(key), 'delete'));
  }
  for (const key of Object.keys(newValue)) {
    if (!visited.has(key)) blocks.push(renderValue(newValue[key]!, depth + 1, propertyPrefix(key), 'insert'));
  }
  blocks.forEach((block, index) => {
    if (index < blocks.length - 1) appendComma(block);
    rows.push(...block);
  });
  rows.push(row('equal', `${indentation(depth)}}`));
  return rows;
}

function diffArray(oldValue: JsonValue[], newValue: JsonValue[], depth: number, prefix: string): DraftRow[] {
  const rows = [row('equal', `${indentation(depth)}${prefix}[`)];
  const blocks = alignArray(oldValue, newValue).map((pair) => {
    if (pair.oldValue !== undefined && pair.newValue !== undefined) return diffValue(pair.oldValue, pair.newValue, depth + 1, '');
    if (pair.oldValue !== undefined) return renderValue(pair.oldValue, depth + 1, '', 'delete');
    return renderValue(pair.newValue!, depth + 1, '', 'insert');
  });
  blocks.forEach((block, index) => {
    if (index < blocks.length - 1) appendComma(block);
    rows.push(...block);
  });
  rows.push(row('equal', `${indentation(depth)}]`));
  return rows;
}

function diffValue(oldValue: JsonValue, newValue: JsonValue, depth: number, prefix: string): DraftRow[] {
  if (serialized(oldValue) === serialized(newValue)) return renderValue(newValue, depth, prefix, 'equal');
  const oldKind = jsonKind(oldValue);
  const newKind = jsonKind(newValue);
  if (oldKind === 'object' && newKind === 'object') return diffObject(oldValue as { [key: string]: JsonValue }, newValue as { [key: string]: JsonValue }, depth, prefix);
  if (oldKind === 'array' && newKind === 'array') return diffArray(oldValue as JsonValue[], newValue as JsonValue[], depth, prefix);
  if (oldKind === 'primitive' && newKind === 'primitive') return diffScalar(oldValue as JsonPrimitive, newValue as JsonPrimitive, depth, prefix);
  return [...renderValue(oldValue, depth, prefix, 'delete'), ...renderValue(newValue, depth, prefix, 'insert')];
}

function numbered(rows: DraftRow[], includeOld = true): FormattedInputDiffRow[] {
  let oldLineNumber = 1;
  let newLineNumber = 1;
  return rows.map((draft) => ({
    ...draft,
    oldLineNumber: !includeOld || draft.type === 'insert' ? null : oldLineNumber++,
    newLineNumber: draft.type === 'delete' ? null : newLineNumber++,
  }));
}

function parseJson(text: string): JsonValue { return JSON.parse(text) as JsonValue; }

export function buildFormattedDiff(parts: DiffPart[], hasParent: boolean): FormattedInputDiffRow[] {
  const { oldText, newText } = reconstructDiff(parts);
  try {
    const newValue = parseJson(newText);
    if (!hasParent) return numbered(renderValue(newValue, 0, '', 'equal'), false);
    return numbered(diffValue(parseJson(oldText), newValue, 0, ''));
  } catch {
    const oldLines = formatDiffText(oldText).split('\n');
    const newLines = formatDiffText(newText).split('\n');
    if (!hasParent) return numbered(newLines.map((line) => row('equal', line)), false);
    return numbered(textRows(oldLines, newLines));
  }
}
