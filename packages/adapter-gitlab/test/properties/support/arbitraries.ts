import type { Pipeline } from "@keelson/core";
import fc from "fast-check";
import { parse } from "../../../src/parse.ts";
import type { Draft } from "../../support/apply.ts";
import { corpusFiles, readCorpus } from "../../support/corpus.ts";

export const FIXED_SEED = 20_261_020;

export function runs(): number {
  const raw = process.env.KEELSON_FC_RUNS;
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? 25 : parsed;
}

function seed(): number | undefined {
  const raw = process.env.KEELSON_FC_SEED;
  if (raw !== undefined) {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return process.env.CI === undefined ? undefined : FIXED_SEED;
}

export function assertOptions(): fc.Parameters<unknown> {
  const base = { numRuns: runs(), verbose: true };
  const chosen = seed();
  return chosen === undefined ? base : { ...base, seed: chosen };
}

const SCRIPT_LINES = ["echo hi", "make", "npm test", "./deploy.sh", "bun run check"] as const;
const SUFFIXES = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"] as const;
const ENVIRONMENTS = ["production", "staging", "review", "integration"] as const;

export function corpusTexts(): string[] {
  return corpusFiles().map((file) => readCorpus(file));
}

function freshName(prefix: string, taken: ReadonlySet<string>): fc.Arbitrary<string> {
  return fc
    .constantFrom(...SUFFIXES)
    .map((suffix) => `${prefix}-${suffix}`)
    .filter((name) => !taken.has(name));
}

function environmentArb(): fc.Arbitrary<{
  name: string;
  url?: string | undefined;
  action?: string | undefined;
}> {
  return fc.record(
    {
      name: fc.constantFrom(...ENVIRONMENTS),
      url: fc.option(fc.constantFrom("https://exemple.org", "https://staging.exemple.org"), {
        nil: undefined,
      }),
      action: fc.option(fc.constantFrom("start", "stop", "prepare"), { nil: undefined }),
    },
    { requiredKeys: ["name"] },
  );
}

function lineStarts(text: string): number[] {
  const positions = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n" && index + 1 < text.length) {
      positions.push(index + 1);
    }
  }
  return positions;
}

export function operationArb(text: string): fc.Arbitrary<Draft> {
  const pipeline: Pipeline = parse(text).pipeline;
  const jobIds = pipeline.jobs.map((job) => job.id);
  const stageNames = pipeline.stages.map((stage) => stage.name);
  const taken = new Set([
    ...jobIds,
    ...stageNames,
    ...pipeline.templates.map((template) => template.id),
  ]);

  const candidates: fc.Arbitrary<Draft>[] = [];

  const commentArb: fc.Arbitrary<Draft> = fc
    .constantFrom(...lineStarts(text))
    .map((at) => ({ kind: "splice", start: at, end: at, text: "# keelson\n" }) as Draft);
  candidates.push(commentArb);

  if (stageNames.length > 0) {
    candidates.push(
      fc
        .tuple(freshName("etape", taken), fc.nat(stageNames.length))
        .map(([name, index]) => ({ kind: "addStage", name, index }) as Draft),
      fc
        .tuple(fc.constantFrom(...stageNames), fc.nat(stageNames.length - 1))
        .map(([name, toIndex]) => ({ kind: "moveStage", name, toIndex }) as Draft),
    );
  }

  if (jobIds.length > 0 && stageNames.length > 0) {
    candidates.push(
      fc
        .record({
          id: freshName("boulot", taken),
          stage: fc.constantFrom(...stageNames),
          script: fc.array(fc.constantFrom(...SCRIPT_LINES), { minLength: 1, maxLength: 3 }),
          needs: fc.option(
            fc.uniqueArray(
              fc.constantFrom(...jobIds).map((job) => ({ job })),
              {
                maxLength: 2,
                selector: (need) => need.job,
              },
            ),
            { nil: undefined },
          ),
        })
        .map((job) => ({ kind: "addJob", job }) as Draft),
      fc.constantFrom(...jobIds).map((id) => ({ kind: "removeJob", id }) as Draft),
      fc
        .tuple(fc.constantFrom(...jobIds), freshName("renomme", taken))
        .map(([from, to]) => ({ kind: "renameJob", from, to }) as Draft),
      fc
        .tuple(fc.constantFrom(...jobIds), fc.constantFrom(...stageNames))
        .map(([id, stage]) => ({ kind: "setJobStage", id, stage }) as Draft),
      fc
        .tuple(fc.constantFrom(...jobIds), fc.constantFrom(...jobIds), fc.boolean(), fc.boolean())
        .map(
          ([id, job, optional, artifacts]) =>
            ({ kind: "addNeed", id, need: { job, optional, artifacts } }) as Draft,
        ),
      fc
        .tuple(fc.constantFrom(...jobIds), fc.constantFrom(...jobIds))
        .map(([id, job]) => ({ kind: "removeNeed", id, job }) as Draft),
      fc
        .tuple(fc.constantFrom(...jobIds), fc.option(environmentArb(), { nil: null }))
        .map(([id, environment]) => ({ kind: "setEnvironment", id, environment }) as Draft),
    );
  }

  return fc.oneof(...candidates);
}

export function operationSequenceArb(text: string, maxLength = 4): fc.Arbitrary<Draft[]> {
  return fc.array(operationArb(text), { minLength: 1, maxLength });
}
