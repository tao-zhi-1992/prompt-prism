function get(map, key) { return map.get(key) ?? -Infinity; }

function coalesce(ops) {
  const result = [];
  for (const op of ops) {
    const last = result.at(-1);
    if (last?.type === op.type) last.value += op.value;
    else result.push({ ...op });
  }
  return result.filter((part) => part.value.length > 0);
}

// Myers' O((N+M)D) shortest-edit-script algorithm.
export function diffCharacters(oldText, newText) {
  const a = Array.from(String(oldText));
  const b = Array.from(String(newText));
  const max = a.length + b.length;
  let frontier = new Map([[1, 0]]);

  for (let distance = 0; distance <= max; distance++) {
    const trace = new Map(frontier);
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      let x;
      if (diagonal === -distance || (diagonal !== distance && get(frontier, diagonal - 1) < get(frontier, diagonal + 1))) {
        x = get(frontier, diagonal + 1);
      } else {
        x = get(frontier, diagonal - 1) + 1;
      }
      let y = x - diagonal;
      while (x < a.length && y < b.length && a[x] === b[y]) { x++; y++; }
      frontier.set(diagonal, x);
      if (x >= a.length && y >= b.length) return backtrack(trace, frontier, distance, a, b);
    }
  }
  return [];
}

function backtrack(firstTrace, finalFrontier, distance, a, b) {
  // Rebuild traces; retaining every frontier is bounded by the edit distance and
  // avoids quadratic LCS memory for long, mostly-equal prompts.
  const traces = [];
  let frontier = new Map([[1, 0]]);
  for (let d = 0; d <= distance; d++) {
    traces.push(new Map(frontier));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && get(frontier, k - 1) < get(frontier, k + 1))
        ? get(frontier, k + 1) : get(frontier, k - 1) + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) { x++; y++; }
      frontier.set(k, x);
    }
  }

  let x = a.length;
  let y = b.length;
  const reversed = [];
  for (let d = distance; d >= 0; d--) {
    const previous = traces[d];
    const k = x - y;
    const previousK = k === -d || (k !== d && get(previous, k - 1) < get(previous, k + 1)) ? k + 1 : k - 1;
    const previousX = get(previous, previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      reversed.push({ type: 'equal', value: a[x - 1] }); x--; y--;
    }
    if (d === 0) break;
    if (x === previousX) { reversed.push({ type: 'insert', value: b[y - 1] }); y--; }
    else { reversed.push({ type: 'delete', value: a[x - 1] }); x--; }
  }
  return coalesce(reversed.reverse());
}

export function divergencePoint(oldText, newText) {
  const oldChars = Array.from(String(oldText));
  const newChars = Array.from(String(newText));
  let index = 0;
  while (index < oldChars.length && index < newChars.length && oldChars[index] === newChars[index]) index++;
  return index;
}
