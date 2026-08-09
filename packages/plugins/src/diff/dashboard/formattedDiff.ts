import { diffArrays, diffChars } from 'diff';

export type DiffPart = { type: 'equal' | 'insert' | 'delete'; value: string };

export type FormattedDiffRow = {
  oldLineNumber: number | null;
  newLineNumber: number | null;
  type: 'equal' | 'delete' | 'insert';
  parts: DiffPart[];
};

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

export function buildFormattedDiff(parts: DiffPart[], hasParent: boolean): FormattedDiffRow[] {
  const { oldText, newText } = reconstructDiff(parts);
  const oldLines = formatDiffText(oldText).split('\n');
  const newLines = formatDiffText(newText).split('\n');
  if (!hasParent) return newLines.map((line, index) => ({ oldLineNumber: null, newLineNumber: index + 1, type: 'equal', parts: wholeLine(line, 'equal') }));
  const changes = diffArrays(oldLines, newLines);
  const rows: FormattedDiffRow[] = [];
  let oldLineNumber = 1;
  let newLineNumber = 1;
  const addDeleted = (line: string, partsForLine = wholeLine(line, 'delete')) => rows.push({ oldLineNumber: oldLineNumber++, newLineNumber: null, type: 'delete', parts: partsForLine });
  const addInserted = (line: string, partsForLine = wholeLine(line, 'insert')) => rows.push({ oldLineNumber: null, newLineNumber: newLineNumber++, type: 'insert', parts: partsForLine });
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index]!;
    if (!change.added && !change.removed) {
      for (const line of change.value) rows.push({ oldLineNumber: oldLineNumber++, newLineNumber: newLineNumber++, type: 'equal', parts: wholeLine(line, 'equal') });
      continue;
    }
    if (change.removed && changes[index + 1]?.added) {
      const removedLines = change.value;
      const addedLines = changes[++index]!.value;
      const paired = Math.min(removedLines.length, addedLines.length);
      for (let lineIndex = 0; lineIndex < paired; lineIndex++) {
        const lineParts = changedLineParts(removedLines[lineIndex]!, addedLines[lineIndex]!);
        addDeleted(removedLines[lineIndex]!, lineParts.removed);
        addInserted(addedLines[lineIndex]!, lineParts.added);
      }
      for (const line of removedLines.slice(paired)) addDeleted(line);
      for (const line of addedLines.slice(paired)) addInserted(line);
      continue;
    }
    if (change.removed) for (const line of change.value) addDeleted(line);
    else for (const line of change.value) addInserted(line);
  }
  return rows;
}
