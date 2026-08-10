import { diffChars } from 'diff';

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
  const parts: DiffPart[] = [];
  const push = (type: DiffType, value: string) => {
    const previous = parts.at(-1);
    if (previous?.type === type) previous.value += value;
    else parts.push({ type, value });
  };
  for (const change of diffChars(left, right)) {
    push(change.added ? 'insert' : change.removed ? 'delete' : 'equal', change.value);
  }
  return parts;
}
