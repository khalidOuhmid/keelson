import { existsSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { isWorkflowPath, parse as parseGithub } from "@keelson/adapter-github";
import { createFileReader, parse, readInsideRoot } from "@keelson/adapter-gitlab";
import { loadCatalog } from "@keelson/catalog";
import type { Diagnostic, Pipeline } from "@keelson/core";
import { TOOLCHAIN_FILE, validate } from "@keelson/core";
import {
  analyseToolchain,
  LAYOUT_FILE,
  type ParsedLayout,
  parseLayout,
  type ToolchainAnalysis,
} from "@keelson/toolchain";

/** Un workflow GitHub vit toujours sous `<racine>/.github/workflows/` : sans `.git`, c'est cette
 *  racine-là, et non le dossier du fichier, qui permet de le reconnaître comme workflow. */
function workflowRoot(file: string): string | null {
  const workflows = dirname(file);
  const github = dirname(workflows);
  return basename(workflows) === "workflows" && basename(github) === ".github"
    ? dirname(github)
    : null;
}

/** La racine depuis laquelle GitLab résout les `include: local`. On remonte jusqu'au premier
 *  dossier qui contient un `.git`, parce que c'est la racine du dépôt que GitLab utilise. Sans
 *  dépôt — un fichier isolé, un test — c'est le dossier du fichier, ce qui revient au cas normal
 *  où `.gitlab-ci.yml` est à la racine. */
function repositoryRoot(file: string): string {
  let current = dirname(file);
  while (true) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return workflowRoot(file) ?? dirname(file);
    }
    current = parent;
  }
}

/** Le chemin du fichier relatif à la racine, en séparateurs `/` : c'est la forme qu'attendent les
 *  `include` et celle que portent les diagnostics. */
function relativeTo(root: string, file: string): string {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return file.startsWith(prefix) ? file.slice(prefix.length).split(sep).join("/") : basename(file);
}

export type ParsedDocument = {
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  included: Record<string, string>;
};

export type Analysis = {
  root: string;
  main: string;
  result: ParsedDocument;
  layout: ParsedLayout;
  toolchain: ToolchainAnalysis;
  diagnostics: Diagnostic[];
};

/** Ce que `validate` et `coverage` savent d'un fichier : les deux doivent dire la même chose. */
export function analyse(file: string, text: string): Analysis {
  const root = repositoryRoot(file);
  const main = relativeTo(root, file);
  const result: ParsedDocument = isWorkflowPath(main)
    ? parseGithub(text, { file: main })
    : parse(text, { file: main, read: createFileReader(root) });
  const layout = parseLayout(readInsideRoot(root, LAYOUT_FILE), result.pipeline);
  const toolchain = analyseToolchain(
    readInsideRoot(root, TOOLCHAIN_FILE),
    result.pipeline,
    loadCatalog().tools,
  );
  return {
    root,
    main,
    result,
    layout,
    toolchain,
    diagnostics: [
      ...result.diagnostics,
      ...validate(result.pipeline),
      ...layout.diagnostics,
      ...toolchain.diagnostics,
    ],
  };
}
