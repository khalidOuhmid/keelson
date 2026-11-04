import { resolve } from "node:path";
import { createFileReader } from "@keelson/adapter-gitlab";

export type AdapterName = "gitlab";

export type WorkspaceFile = {
  path: string;
  adapter: AdapterName;
};

export const GITLAB_CI_FILE = ".gitlab-ci.yml";

export function detectWorkspace(root: string): WorkspaceFile[] {
  return createFileReader(root).read(GITLAB_CI_FILE) === null
    ? []
    : [{ path: GITLAB_CI_FILE, adapter: "gitlab" }];
}

export function resolveWorkspaceFile(
  root: string,
  files: readonly WorkspaceFile[],
  requested: string,
): string | null {
  const known = files.find((file) => file.path === requested);
  if (known === undefined) {
    return null;
  }
  return resolve(root, known.path);
}
