export type SourceRange = {
  start: number;
  end: number;
};

export type Origin =
  | { kind: "local" }
  | { kind: "default" }
  | { kind: "extends"; template: string }
  | { kind: "anchor"; name: string }
  | { kind: "reference"; path: string[] };

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
};

export type Stage = {
  name: string;
  implicit: boolean;
  range: SourceRange | null;
};

export type Job = {
  id: string;
  stage: Valued<string>;
  needs: Valued<Need[]> | null;
  environment: Valued<Environment> | null;
  extends: string[];
  opaque: OpaqueBlock[];
  range: SourceRange;
};

export type Template = {
  id: string;
  range: SourceRange;
};

export type Pipeline = {
  stages: Stage[];
  jobs: Job[];
  templates: Template[];
  opaque: OpaqueBlock[];
};

export function findJob(pipeline: Pipeline, id: string): Job | undefined {
  return pipeline.jobs.find((candidate) => candidate.id === id);
}

export function stageIndex(pipeline: Pipeline, name: string): number {
  return pipeline.stages.findIndex((stage) => stage.name === name);
}
