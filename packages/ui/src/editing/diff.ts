export type DiffRow = { kind: "same" | "add" | "remove"; text: string };

export type VisibleRow = DiffRow | { kind: "gap"; text: "" };

/** Au-delà, la table de la plus longue sous-suite coûterait plus qu'elle n'apporte : le milieu est
 *  rendu comme remplacé, ce qui reste vrai. */
const MAX_CELLS = 4_000_000;

function linesOf(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function middle(left: readonly string[], right: readonly string[]): DiffRow[] {
  const rows = left.length + 1;
  const columns = right.length + 1;
  if (rows * columns > MAX_CELLS) {
    return [
      ...left.map((text): DiffRow => ({ kind: "remove", text })),
      ...right.map((text): DiffRow => ({ kind: "add", text })),
    ];
  }

  const table = new Uint32Array(rows * columns);
  for (let row = left.length - 1; row >= 0; row -= 1) {
    for (let column = right.length - 1; column >= 0; column -= 1) {
      table[row * columns + column] =
        left[row] === right[column]
          ? (table[(row + 1) * columns + column + 1] ?? 0) + 1
          : Math.max(
              table[(row + 1) * columns + column] ?? 0,
              table[row * columns + column + 1] ?? 0,
            );
    }
  }

  const found: DiffRow[] = [];
  let row = 0;
  let column = 0;
  while (row < left.length && column < right.length) {
    if (left[row] === right[column]) {
      found.push({ kind: "same", text: left[row] ?? "" });
      row += 1;
      column += 1;
    } else if (
      (table[(row + 1) * columns + column] ?? 0) >= (table[row * columns + column + 1] ?? 0)
    ) {
      found.push({ kind: "remove", text: left[row] ?? "" });
      row += 1;
    } else {
      found.push({ kind: "add", text: right[column] ?? "" });
      column += 1;
    }
  }
  for (; row < left.length; row += 1) {
    found.push({ kind: "remove", text: left[row] ?? "" });
  }
  for (; column < right.length; column += 1) {
    found.push({ kind: "add", text: right[column] ?? "" });
  }
  return found;
}

/** Par lignes : une composite touche une seule plage, souvent presque tout le fichier, et le
 *  milieu y est pourtant inchangé (ADR 0012). */
export function diffRows(before: string, after: string): DiffRow[] {
  const left = linesOf(before);
  const right = linesOf(after);

  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) {
    start += 1;
  }
  let end = 0;
  while (
    end < left.length - start &&
    end < right.length - start &&
    left[left.length - 1 - end] === right[right.length - 1 - end]
  ) {
    end += 1;
  }

  return [
    ...left.slice(0, start).map((text): DiffRow => ({ kind: "same", text })),
    ...middle(left.slice(start, left.length - end), right.slice(start, right.length - end)),
    ...left.slice(left.length - end).map((text): DiffRow => ({ kind: "same", text })),
  ];
}

/** Ne garde que `context` lignes autour de chaque changement, un `gap` tient lieu du reste. */
export function visibleRows(rows: readonly DiffRow[], context: number): VisibleRow[] {
  const near = rows.map((_, index) =>
    rows
      .slice(Math.max(0, index - context), index + context + 1)
      .some((row) => row.kind !== "same"),
  );
  return rows.flatMap((row, index): VisibleRow[] => {
    if (near[index]) {
      return [row];
    }
    return near[index - 1] === true || index === 0 ? [{ kind: "gap", text: "" }] : [];
  });
}
