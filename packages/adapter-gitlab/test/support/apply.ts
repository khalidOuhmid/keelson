import { expect } from "bun:test";
import { hashText, type Operation, type OperationErrorCode } from "@keelson/core";
import { renderMessage } from "@keelson/core/messages";
import { apply } from "../../src/apply.ts";
import { parse } from "../../src/parse.ts";
import type { ApplyError, ApplyOk } from "../../src/result.ts";

type WithoutEnvelope<T> = T extends unknown ? Omit<T, "v" | "baseHash"> : never;

export type Draft = WithoutEnvelope<Operation>;

export const BASE = [
  "stages:",
  "  - build",
  "  - test",
  "  - deploy",
  "",
  "compile:",
  "  stage: build",
  "  script:",
  "    - make",
  "",
  "unit:",
  "  stage: test",
  "  needs:",
  "    - compile",
  "  script:",
  "    - make check",
  "",
].join("\n");

export function operation(text: string, draft: Draft): Operation {
  return { v: 1, baseHash: hashText(text), ...draft } as Operation;
}

export function run(text: string, draft: Draft) {
  return apply(parse(text).document, operation(text, draft));
}

export function expectOk(text: string, draft: Draft): ApplyOk {
  const result = run(text, draft);
  if (!result.ok) {
    throw new Error(`operation refused: ${result.error.code} — ${renderMessage(result.error)}`);
  }
  return result.value;
}

export function expectError(text: string, draft: Draft, code: OperationErrorCode): ApplyError {
  const result = run(text, draft);
  if (result.ok) {
    throw new Error(`operation accepted while ${code} was expected`);
  }
  expect(result.error.code).toBe(code);
  return result.error;
}

export function expectUnchanged(text: string, draft: Draft, code: OperationErrorCode): ApplyError {
  const error = expectError(text, draft, code);
  expect(parse(text).document.text).toBe(text);
  return error;
}

export function roundTrip(text: string, draft: Draft): void {
  const applied = expectOk(text, draft);
  const back = apply(applied.document, applied.inverse);
  if (!back.ok) {
    throw new Error(`inverse refused: ${back.error.code} — ${renderMessage(back.error)}`);
  }
  expect(back.value.text).toBe(text);
}

export function jobOf(text: string, id: string) {
  const found = parse(text).pipeline.jobs.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`job "${id}" missing`);
  }
  return found;
}
