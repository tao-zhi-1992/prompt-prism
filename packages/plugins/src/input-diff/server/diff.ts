/** Character operations used by each Input Diff section. */
export type DiffType = 'equal' | 'insert' | 'delete';

export interface DiffPart {
  type: DiffType;
  value: string;
}

export function divergencePoint(left: string, right: string): number {
  let offset = 0;
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  while (offset < leftPoints.length && offset < rightPoints.length && leftPoints[offset] === rightPoints[offset]) offset++;
  return leftPoints.slice(0, offset).join('').length;
}

export function diffCharacters(left: string, right: string): DiffPart[] {
  const a = Array.from(left);
  const b = Array.from(right);
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  const at = (i: number, j: number) => i * cols + j;

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[at(i, j)] = a[i] === b[j]
        ? (table[at(i + 1, j + 1)] ?? 0) + 1
        : Math.max(table[at(i + 1, j)] ?? 0, table[at(i, j + 1)] ?? 0);
    }
  }

  const parts: DiffPart[] = [];
  const push = (type: DiffType, value: string) => {
    const previous = parts.at(-1);
    if (previous?.type === type) previous.value += value;
    else parts.push({ type, value });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push('equal', a[i] ?? ''); i++; j++;
    } else if (j < b.length && (i === a.length || (table[at(i, j + 1)] ?? 0) >= (table[at(i + 1, j)] ?? 0))) {
      push('insert', b[j] ?? ''); j++;
    } else {
      push('delete', a[i] ?? ''); i++;
    }
  }
  return parts;
}
