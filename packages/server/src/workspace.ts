import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { WORKFLOWS_DIR } from "@keelson/adapter-github";
import { createFileReader } from "@keelson/adapter-gitlab";
import { type Diagnostic, INVALID_YAML } from "@keelson/core";
import { readDisk } from "./disk.ts";

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

function workflowPaths(root: string): YamlPath[] {
  let names: string[] = [];
  try {
    names = readdirSync(join(root, WORKFLOWS_DIR)).sort();
  } catch {
    names = [];
  }
  return names.map((name) => `${WORKFLOWS_DIR}/${name}`).filter(isYamlPath);
}

export function detectWorkspace(root: string): WorkspaceFile[] {
  const reader = createFileReader(root);
  const gitlab: WorkspaceFile[] =
    reader.read(GITLAB_CI_FILE) === null ? [] : [{ path: GITLAB_CI_FILE, adapter: "gitlab" }];
  const github = workflowPaths(root)
    .filter((path) => reader.read(path) !== null)
    .map((path): WorkspaceFile => ({ path, adapter: "github" }));
  return [...gitlab, ...github];
}

/** The CI files that exist but give no text: not UTF-8, refusing reading, or a link out of the
 *  root. Their jobs are missing from the repository, as those of an unresolved include are, and
 *  each says so with a diagnostic that makes the analysis partial. */
export function unreadableWorkspaceFiles(root: string): Diagnostic[] {
  return [GITLAB_CI_FILE, ...workflowPaths(root)]
    .filter((path) => readDisk(root, path).kind === "unreadable")
    .map(
      (file): Diagnostic => ({
        code: INVALID_YAML,
        severity: "error",
        params: { detail: "the file cannot be read" },
        range: null,
        file,
      }),
    );
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
