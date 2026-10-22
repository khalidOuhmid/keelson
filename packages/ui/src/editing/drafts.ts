import type { ApiFailure } from "../api/client.ts";
import type { Draft } from "../state/store.ts";

export type EnvironmentInput = {
  name: string;
  url?: string;
  action?: string;
};

export type NeedOptions = {
  optional?: boolean;
  artifacts?: boolean;
};

export type NewJobInput = {
  id: string;
  stage: string;
  script: string;
  needs?: readonly string[];
  environment?: EnvironmentInput;
};

export function scriptLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function trimmed(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate === undefined || candidate === "" ? undefined : candidate;
}

function environmentOf(input: EnvironmentInput): EnvironmentInput {
  const url = trimmed(input.url);
  const action = trimmed(input.action);
  return {
    name: input.name,
    ...(url === undefined ? {} : { url }),
    ...(action === undefined ? {} : { action }),
  };
}

export function addJob(input: NewJobInput): Draft {
  return {
    kind: "addJob",
    job: {
      id: input.id,
      stage: input.stage,
      script: scriptLines(input.script),
      ...(input.needs === undefined || input.needs.length === 0
        ? {}
        : { needs: input.needs.map((job) => ({ job })) }),
      ...(input.environment === undefined ? {} : { environment: environmentOf(input.environment) }),
    },
  };
}

export function renameJob(from: string, to: string): Draft {
  return { kind: "renameJob", from, to };
}

export function removeJob(id: string): Draft {
  return { kind: "removeJob", id };
}

export function setJobStage(id: string, stage: string): Draft {
  return { kind: "setJobStage", id, stage };
}

export function addNeed(id: string, job: string, options: NeedOptions = {}): Draft {
  return {
    kind: "addNeed",
    id,
    need: {
      job,
      ...(options.optional === true ? { optional: true } : {}),
      ...(options.artifacts === false ? { artifacts: false } : {}),
    },
  };
}

export function removeNeed(id: string, job: string): Draft {
  return { kind: "removeNeed", id, job };
}

export function setEnvironment(id: string, environment: EnvironmentInput | null): Draft {
  return {
    kind: "setEnvironment",
    id,
    environment: environment === null ? null : environmentOf(environment),
  };
}

export function addStage(name: string, index?: number): Draft {
  return { kind: "addStage", name, ...(index === undefined ? {} : { index }) };
}

export function moveStage(name: string, toIndex: number): Draft {
  return { kind: "moveStage", name, toIndex };
}

export function referencedBy(error: ApiFailure): string[] {
  const details = error.details;
  if (typeof details !== "object" || details === null) {
    return [];
  }
  const listed = (details as { referencedBy?: unknown }).referencedBy;
  return Array.isArray(listed)
    ? listed.filter((entry): entry is string => typeof entry === "string")
    : [];
}
