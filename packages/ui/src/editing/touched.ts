import type { SourceRange } from "@keelson/core";

function lineAt(text: string, offset: number): number {
  let line = 1;
  const stop = Math.min(Math.max(offset, 0), text.length);
  for (let index = 0; index < stop; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return line;
}

function spell(span: { from: number; to: number }): string {
  return span.from === span.to ? `${span.from}` : `${span.from}–${span.to}`;
}

/** The sentence after a write: `touched` are ranges of the new text, so the lines are those of
 *  the file as it now is. */
export function describeTouched(
  file: string,
  text: string,
  touched: readonly SourceRange[],
): string | null {
  const spans = touched
    .map((range) => ({
      from: lineAt(text, range.start),
      to: lineAt(text, Math.max(range.start, range.end - 1)),
    }))
    .sort((left, right) => left.from - right.from);

  const merged: { from: number; to: number }[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last !== undefined && span.from <= last.to + 1) {
      last.to = Math.max(last.to, span.to);
    } else {
      merged.push({ ...span });
    }
  }

  const first = merged[0];
  if (first === undefined) {
    return null;
  }
  const single = merged.length === 1 && first.from === first.to;
  const parts = merged.map(spell);
  const listed =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Changed ${single ? "line" : "lines"} ${listed} of ${file}.`;
}
