export const DEFAULT_STAGES = [".pre", "build", "test", "deploy", ".post"] as const;

export const DEFAULT_STAGE = "test";

/** GitLab pins these two: `.pre` always runs first and `.post` last, wherever `stages` lists them. */
export const FIRST_STAGE = ".pre";

export const LAST_STAGE = ".post";

export const RESERVED_TOP_LEVEL = [
  "after_script",
  "before_script",
  "cache",
  "default",
  "image",
  "include",
  "services",
  "stages",
  "types",
  "variables",
  "workflow",
] as const;

export const MAX_EXTENDS_DEPTH = 11;

export function isReservedTopLevel(key: string): boolean {
  return RESERVED_TOP_LEVEL.includes(key as never);
}
