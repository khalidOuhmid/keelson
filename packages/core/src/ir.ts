export type SourceRange = {
  start: number;
  end: number;
};

export type Origin =
  | { kind: "local" }
  | { kind: "default" }
  | { kind: "extends"; template: string }
  | { kind: "anchor"; name: string }
  | { kind: "reference"; path: string[] }
  /** The value comes from the definition with the same name in an included file, which the
   *  current file did not override. */
  | { kind: "include"; file: string };

export type Valued<T> = {
  value: T;
  origin: Origin;
};

export type Need = {
  job: string;
  optional: boolean;
  artifacts: boolean;
};

export type Environment = {
  name: string;
  url?: string;
  action?: string;
};

export type OpaqueBlock = {
  key: string;
  range: SourceRange;
  /** The file `range` is an offset into. An opaque block is rendered on screen by slicing the
   *  bytes of the text: reading those of another file would show a fragment taken elsewhere. */
  file: string;
};

/** `file` is the path, relative to the repository root, of the file holding the **last**
 *  definition of the element in GitLab's merge order — hence the one a user would edit, and the
 *  only one Keelson agrees to rewrite when it is the main file. `range` is an offset into the text
 *  of **this** file, not into that of the main file. */
export type Stage = {
  name: string;
  implicit: boolean;
  range: SourceRange | null;
  file: string;
};

/** What a job runs, as effective values: this is what layer detection works on.
 *  Provider-neutral. `script` concatenates `before_script`, `script` and `after_script`. */
export type JobSignals = {
  image: string | null;
  script: string[];
  /** The GitHub actions (`owner/repo@ref`) of the job's steps, and `docker://<image>` for each
   *  further container it runs: a matrix `container`, a job of a called workflow. Absent elsewhere. */
  actions?: string[];
};

export type Job = {
  id: string;
  stage: Valued<string>;
  needs: Valued<Need[]> | null;
  /** The `needs` list carries items the IR does not model, cross-project or nested: rewriting it
   *  would lose them. Absent when there are none. */
  unmodelledNeeds?: true;
  environment: Valued<Environment> | null;
  extends: string[];
  /** The templates whose map is merged into the job through a merge key (`<<: *anchor`), in
   *  order. Absent when there are none. */
  merges?: string[];
  opaque: OpaqueBlock[];
  signals: JobSignals;
  range: SourceRange;
  file: string;
};

export type Template = {
  id: string;
  range: SourceRange;
  file: string;
  /** The templates this one extends, as a job's `extends`. */
  extends: string[];
  /** As a job's `merges`. */
  merges?: string[];
};

/** An `include` whose content is missing from the displayed pipeline: the four remote forms, and
 *  `local` when the caller provided no reader or the file could not be resolved. `detail` is the
 *  value as written, so that the screen can say what is missing and not only that something is. */
export type UnresolvedInclude = {
  form: "local" | "remote" | "project" | "template" | "component" | "workflow";
  detail: string;
  /** The file that carries the `include` key, not the target. */
  from: string;
  range: SourceRange | null;
};

export type Pipeline = {
  stages: Stage[];
  jobs: Job[];
  templates: Template[];
  opaque: OpaqueBlock[];
  /** The main file: the one Keelson writes. */
  main: string;
  /** The main file and every resolved included file, in merge order. */
  files: string[];
  unresolved: UnresolvedInclude[];
  /** Absent on GitLab. `github`: stages are derived from `needs` (ADR 0013). */
  provider?: "github";
};

/** A pipeline with nothing in it, named only once: the UI needs it while nothing is loaded, and
 *  `parse` needs it when the file root is not a map. */
export function emptyPipeline(main: string): Pipeline {
  return { stages: [], jobs: [], templates: [], opaque: [], main, files: [], unresolved: [] };
}

/** Several files seen as a single repository, for what concerns the repository rather than one
 *  file: the toolchain, `keelson coverage` without arguments. Two workflows can carry a job with
 *  the same name: both stay, and their coverage counts. */
export function mergePipelines(pipelines: readonly Pipeline[]): Pipeline {
  const first = pipelines[0];
  if (first === undefined) {
    return emptyPipeline("");
  }
  const stages = new Map<string, Stage>();
  for (const stage of pipelines.flatMap((pipeline) => pipeline.stages)) {
    if (!stages.has(stage.name)) {
      stages.set(stage.name, stage);
    }
  }
  return {
    ...first,
    jobs: pipelines.flatMap((pipeline) => pipeline.jobs),
    stages: [...stages.values()],
    templates: pipelines.flatMap((pipeline) => pipeline.templates),
    opaque: pipelines.flatMap((pipeline) => pipeline.opaque),
    files: [...new Set(pipelines.flatMap((pipeline) => pipeline.files))],
    unresolved: pipelines.flatMap((pipeline) => pipeline.unresolved),
  };
}

/** A pipeline is **partial** as soon as an include was not resolved: jobs may be missing from the
 *  screen. Derived rather than stored — a stored boolean can lie, this one cannot. */
export function isPartial(pipeline: Pipeline): boolean {
  return pipeline.unresolved.length > 0;
}

export function findJob(pipeline: Pipeline, id: string): Job | undefined {
  return pipeline.jobs.find((candidate) => candidate.id === id);
}

export function stageIndex(pipeline: Pipeline, name: string): number {
  return pipeline.stages.findIndex((stage) => stage.name === name);
}
