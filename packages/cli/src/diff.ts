import { diffRows } from "@keelson/core";

export type Hunk = {
  before: { start: number; count: number };
  after: { start: number; count: number };
  removed: string[];
  added: string[];
};

/** The hunks of a unified diff without context (`-U0`). A hunk empty on one side carries, as in
 *  `diff`, the number of the line **after** which it is inserted. */
export function hunks(before: string, after: string): Hunk[] {
  const found: Hunk[] = [];
  let line = { before: 0, after: 0 };
  let current: Hunk | null = null;

  for (const row of diffRows(before, after)) {
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
