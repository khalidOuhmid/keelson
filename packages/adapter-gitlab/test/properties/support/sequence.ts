import { hashText, type Operation, type SpliceOperation } from "@keelson/core";
import { renderMessage } from "@keelson/core/messages";
import { apply } from "../../../src/apply.ts";
import { parse } from "../../../src/parse.ts";
import type { Draft } from "../../support/apply.ts";

export type SequenceRun = {
  text: string;
  inverses: SpliceOperation[];
  accepted: number;
  rejected: number;
};

export function runSequence(start: string, drafts: readonly Draft[]): SequenceRun {
  let text = start;
  const inverses: SpliceOperation[] = [];
  let accepted = 0;
  let rejected = 0;

  for (const draft of drafts) {
    const document = parse(text).document;
    const operation = { v: 1, baseHash: hashText(text), ...draft } as Operation;
    const result = apply(document, operation);

    if (!result.ok) {
      rejected += 1;
      continue;
    }

    accepted += 1;
    text = result.value.text;
    inverses.push(result.value.inverse);
  }

  return { text, inverses, accepted, rejected };
}

export function undoAll(run: SequenceRun): string {
  let text = run.text;

  for (const inverse of [...run.inverses].reverse()) {
    const document = parse(text).document;
    const result = apply(document, { ...inverse, baseHash: hashText(text) });
    if (!result.ok) {
      throw new Error(`inverse refused: ${result.error.code} — ${renderMessage(result.error)}`);
    }
    text = result.value.text;
  }

  return text;
}
