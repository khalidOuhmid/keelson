export type Hunk = {
  before: { start: number; count: number };
  after: { start: number; count: number };
  removed: string[];
  added: string[];
};

/** Au-delà, la table de la plus longue sous-suite commune coûterait plus qu'elle n'apporte : le
 *  milieu est rendu comme remplacé, ce qui reste vrai. */
const MAX_CELLS = 4_000_000;

function linesOf(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

type Row = { kind: "same" | "add" | "remove"; text: string };

function rows(left: readonly string[], right: readonly string[]): Row[] {
  const columns = right.length + 1;
  if ((left.length + 1) * columns > MAX_CELLS) {
    return [
      ...left.map((text): Row => ({ kind: "remove", text })),
      ...right.map((text): Row => ({ kind: "add", text })),
    ];
  }

  const table = new Uint32Array((left.length + 1) * columns);
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

  const found: Row[] = [];
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

/** Les blocs d'un diff unifié sans contexte (`-U0`). Un bloc vide d'un côté porte, comme chez
 *  `diff`, le numéro de la ligne **après** laquelle il s'insère. */
export function hunks(before: string, after: string): Hunk[] {
  const found: Hunk[] = [];
  let line = { before: 0, after: 0 };
  let current: Hunk | null = null;

  for (const row of rows(linesOf(before), linesOf(after))) {
    if (row.kind === "same") {
      current = null;
      line = { before: line.before + 1, after: line.after + 1 };
      continue;
    }
    if (current === null) {
      current = {
        before: { start: line.before, count: 0 },
        after: { start: line.after, count: 0 },
        removed: [],
        added: [],
      };
      found.push(current);
    }
    if (row.kind === "remove") {
      current.removed.push(row.text);
      current.before.count += 1;
      line = { ...line, before: line.before + 1 };
    } else {
      current.added.push(row.text);
      current.after.count += 1;
      line = { ...line, after: line.after + 1 };
    }
  }

  return found.map((hunk) => ({
    ...hunk,
    before: { ...hunk.before, start: hunk.before.start + (hunk.before.count > 0 ? 1 : 0) },
    after: { ...hunk.after, start: hunk.after.start + (hunk.after.count > 0 ? 1 : 0) },
  }));
}

export function renderUnified(label: string, before: string, after: string): string {
  const lines = [`--- ${label}`, `+++ ${label}`];
  for (const hunk of hunks(before, after)) {
    lines.push(
      `@@ -${hunk.before.start},${hunk.before.count} +${hunk.after.start},${hunk.after.count} @@`,
      ...hunk.removed.map((text) => `-${text}`),
      ...hunk.added.map((text) => `+${text}`),
    );
  }
  return `${lines.join("\n")}\n`;
}
