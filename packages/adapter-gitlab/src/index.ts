export const PACKAGE_NAME = "@keelson/adapter-gitlab";

export { DEFAULT_STAGE, DEFAULT_STAGES, RESERVED_TOP_LEVEL } from "./defaults.ts";
export type { GitlabDocument } from "./document.ts";
export { applySplices, emit, type Splice } from "./emit.ts";
export { type ParseResult, parse } from "./parse.ts";
export type { ApplyError, ApplyOk } from "./result.ts";
