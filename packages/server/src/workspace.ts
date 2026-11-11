import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { GITHUB_WORKFLOWS_DIR, isWorkflowPath } from "@keelson/adapter-github";
import { createFileReader } from "@keelson/adapter-gitlab";

export type AdapterName = "gitlab" | "github";

export type WorkspaceFile = {
  path: string;
  adapter: AdapterName;
};

export const GITLAB_CI_FILE = ".gitlab-ci.yml";

function workflowFiles(root: string): string[] {
  try {
    return readdirSync(resolve(root, GITHUB_WORKFLOWS_DIR))
      .map((name) => `${GITHUB_WORKFLOWS_DIR}/${name}`)
      .filter(isWorkflowPath)
      .sort();
  } catch {
    return [];
  }
}

/** Le fichier GitLab d'abord, puis les workflows GitHub par ordre alphabétique : l'écran ouvre le
 *  premier, et un dépôt qui a les deux est d'abord un dépôt GitLab. Chaque candidat passe par le
 *  lecteur, qui tient la frontière de la racine. */
export function detectWorkspace(root: string): WorkspaceFile[] {
  const reader = createFileReader(root);
  const gitlab: WorkspaceFile[] =
    reader.read(GITLAB_CI_FILE) === null ? [] : [{ path: GITLAB_CI_FILE, adapter: "gitlab" }];
  const github = workflowFiles(root)
    .filter((path) => reader.read(path) !== null)
    .map((path): WorkspaceFile => ({ path, adapter: "github" }));
  return [...gitlab, ...github];
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
