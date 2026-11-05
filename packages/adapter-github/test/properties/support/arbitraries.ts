import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Operation } from "@keelson/core";
import fc from "fast-check";
import { parse } from "../../../src/index.ts";

export const FILE = ".github/workflows/ci.yml";

export function assertOptions(): fc.Parameters<unknown> {
  const seed = process.env.KEELSON_FC_SEED;
  return {
    numRuns: Number(process.env.KEELSON_FC_RUNS ?? 25),
    ...(seed === undefined ? {} : { seed: Number(seed) }),
  };
}

const CORPUS = join(import.meta.dir, "..", "..", "corpus");

export function corpusTexts(): string[] {
  return ["starter-workflows", "edge-cases"].flatMap((group) =>
    readdirSync(join(CORPUS, group))
      .sort()
      .map((name) => readFileSync(join(CORPUS, group, name), "utf8")),
  );
}

export type Draft = Record<string, unknown> & { kind: string };

const fresh = fc.constantFrom("nouveau", "lint_2", "Zz-9");

export function operationArb(text: string): fc.Arbitrary<Draft> {
  const { pipeline } = parse(text, { file: FILE });
  const ids = pipeline.jobs.map((job) => job.id);
  const candidates: fc.Arbitrary<Draft>[] = [
    fresh.map((id) => ({ kind: "addJob", job: { id, stage: "", script: ["make"] } })),
    fresh.map((id) => ({
      kind: "addSnippet",
      id,
      stage: "",
      snippet: "- name: Scan\n  run: |\n    trivy fs .\n    echo ok\n",
    })),
  ];

  if (ids.length > 0) {
    const id = fc.constantFrom(...ids);
    candidates.push(
      id.map((target) => ({ kind: "removeJob", id: target })),
      fc.tuple(id, fresh).map(([from, to]) => ({ kind: "renameJob", from, to })),
      fc.tuple(id, id).map(([target, need]) => ({
        kind: "addNeed",
        id: target,
        need: { job: need },
      })),
      fc.tuple(id, fresh).map(([target, need]) => ({
        kind: "addNeed",
        id: target,
        need: { job: need },
      })),
      fc.tuple(id, fc.constantFrom("prod", "staging")).map(([target, name]) => ({
        kind: "setEnvironment",
        id: target,
        environment: { name },
      })),
      id.map((target) => ({ kind: "setEnvironment", id: target, environment: null })),
      id.chain((target): fc.Arbitrary<Draft> => {
        const needs = pipeline.jobs.find((job) => job.id === target)?.needs?.value ?? [];
        return needs.length === 0
          ? fc.constant({ kind: "removeJob", id: target })
          : fc
              .constantFrom(...needs)
              .map((need) => ({ kind: "removeNeed", id: target, job: need.job }));
      }),
    );
  }

  return fc.oneof(...candidates);
}

export const scenario = (): fc.Arbitrary<{ text: string; draft: Draft }> =>
  fc
    .constantFrom(...corpusTexts())
    .chain((text) => operationArb(text).map((draft) => ({ text, draft })));

export const op = (hash: string, draft: Draft): Operation =>
  ({ v: 1, baseHash: hash, ...draft }) as Operation;

/** Les refus attendus sur le corpus : tout autre refus, `wouldBreakYaml` d'abord, est un défaut. */
export function isExpectedRefusal(error: { code: string; params: unknown }): boolean {
  if (
    [
      "NAME_CONFLICT",
      "JOB_NOT_FOUND",
      "JOB_REFERENCED",
      "NEED_EXISTS",
      "NEED_NOT_FOUND",
      "CYCLE",
    ].includes(error.code)
  ) {
    return true;
  }
  const reason = (error.params as { reason?: string }).reason;
  return (
    error.code === "INVALID_OPERATION" && (reason === "sharedValue" || reason === "notForProvider")
  );
}
