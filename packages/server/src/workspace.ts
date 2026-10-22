import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export type AdapterName = "gitlab";

export type WorkspaceFile = {
  path: string;
  adapter: AdapterName;
};

export const GITLAB_CI_FILE = ".gitlab-ci.yml";

export function detectWorkspace(root: string): WorkspaceFile[] {
  const candidate = join(root, GITLAB_CI_FILE);
  try {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return [{ path: GITLAB_CI_FILE, adapter: "gitlab" }];
    }
  } catch {
    return [];
  }
  return [];
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
