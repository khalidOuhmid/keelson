import type { Job, Need, Pipeline, SourceRange, Stage, Valued } from "../../src/ir.ts";

/** The fixtures' main file. A `file` per element has been mandatory since `include` resolution:
 *  single-file fixtures therefore all name this one. */
export const MAIN = ".gitlab-ci.yml";

export function range(start = 0, end = 1): SourceRange {
  return { start, end };
}

export function local<T>(value: T): Valued<T> {
  return { value, origin: { kind: "local" } };
}

export function need(job: string, extra: Partial<Omit<Need, "job">> = {}): Need {
  return { job, optional: extra.optional ?? false, artifacts: extra.artifacts ?? true };
}

export function job(id: string, stage: string, needs?: readonly string[] | readonly Need[]): Job {
  const normalised =
    needs === undefined
      ? null
      : local(needs.map((entry) => (typeof entry === "string" ? need(entry) : entry)));

  return {
    id,
    stage: local(stage),
    needs: normalised,
    environment: null,
    extends: [],
    opaque: [],
    signals: { image: null, script: [] },
    range: range(),
    file: MAIN,
  };
}

export function stages(...names: readonly string[]): Stage[] {
  return names.map((name) => ({ name, implicit: false, range: range(), file: MAIN }));
}

export function pipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    stages: overrides.stages ?? stages("build", "test", "deploy"),
    jobs: overrides.jobs ?? [],
    templates: overrides.templates ?? [],
    opaque: overrides.opaque ?? [],
    main: overrides.main ?? MAIN,
    files: overrides.files ?? [MAIN],
    unresolved: overrides.unresolved ?? [],
  };
}
