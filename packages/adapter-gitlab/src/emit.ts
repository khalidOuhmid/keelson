import type { SourceRange } from "@keelson/core";
import type { GitlabDocument } from "./document.ts";

export type Splice = {
  start: number;
  end: number;
  text: string;
};

export function emit(document: GitlabDocument): string {
  return document.text;
}

export function applySplices(
  text: string,
  splices: readonly Splice[],
): { text: string; touched: SourceRange[] } {
  const ordered = [...splices].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );

  for (const [index, splice] of ordered.entries()) {
    if (splice.start > splice.end) {
      throw new Error(`inverted splice: ${splice.start} > ${splice.end}`);
    }
    const previous = ordered[index - 1];
    if (previous !== undefined && splice.start < previous.end) {
      throw new Error(`splices chevauchants : ${previous.end} > ${splice.start}`);
    }
  }

  const pieces: string[] = [];
  const touched: SourceRange[] = [];
  let cursor = 0;
  let produced = 0;

  for (const splice of ordered) {
    const kept = text.slice(cursor, splice.start);
    pieces.push(kept, splice.text);
    produced += kept.length;
    touched.push({ start: produced, end: produced + splice.text.length });
    produced += splice.text.length;
    cursor = splice.end;
  }

  pieces.push(text.slice(cursor));
  return { text: pieces.join(""), touched };
}
