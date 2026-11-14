export const PACKAGE_NAME = "@keelson/adapter-github";

export { apply } from "./apply.ts";
export {
  type GithubDocument,
  type ParseOptions,
  type ParseResult,
  parse,
  WORKFLOWS_DIR,
} from "./parse.ts";
export type { WorkflowReader } from "./signals.ts";
