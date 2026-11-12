import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { WORKFLOWS_DIR } from "@keelson/adapter-github";
import { createFileReader } from "@keelson/adapter-gitlab";

export type AdapterName = "gitlab" | "github";

/** `DocumentStore` reads a main file through the include reader, which only opens YAML: an
 *  adapter for another format needs its own reader before this type can widen. */
export type YamlPath = `${string}.yml` | `${string}.yaml`;

export type WorkspaceFile = {
  path: YamlPath;
  adapter: AdapterName;
};

export const GITLAB_CI_FILE = ".gitlab-ci.yml";

const isYamlPath = (path: string): path is YamlPath => /\.ya?ml$/.test(path);

export function detectWorkspace(root: string): WorkspaceFile[] {
  const reader = createFileReader(root);
  const gitlab: WorkspaceFile[] =
    reader.read(GITLAB_CI_FILE) === null ? [] : [{ path: GITLAB_CI_FILE, adapter: "gitlab" }];

  let names: string[] = [];
  try {
    names = readdirSync(join(root, WORKFLOWS_DIR)).sort();
  } catch {
    names = [];
  }
  const github = names
    .map((name) => `${WORKFLOWS_DIR}/${name}`)
    .filter(isYamlPath)
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
