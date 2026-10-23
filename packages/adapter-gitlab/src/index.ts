export const PACKAGE_NAME = "@keelson/adapter-gitlab";

export { apply } from "./apply.ts";
export { DEFAULT_STAGE, DEFAULT_STAGES, RESERVED_TOP_LEVEL } from "./defaults.ts";
export type { GitlabDocument } from "./document.ts";
export { applySplices, emit, type Splice } from "./emit.ts";
export {
  type IncludeReader,
  MAX_INCLUDED_FILES,
  type ParsedFile,
} from "./includes.ts";
export { GITLAB_CI_FILE, type ParseOptions, type ParseResult, parse } from "./parse.ts";
export { createFileReader } from "./reader.ts";
export type { ApplyError, ApplyOk } from "./result.ts";
