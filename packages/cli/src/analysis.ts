import { existsSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { createFileReader, type ParseResult, parse, readInsideRoot } from "@keelson/adapter-gitlab";
import type { Diagnostic } from "@keelson/core";
import { validate } from "@keelson/core";
import { LAYOUT_FILE, type ParsedLayout, parseLayout } from "@keelson/toolchain";

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
      return dirname(file);
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

export type Analysis = {
  root: string;
  main: string;
  result: ParseResult;
  layout: ParsedLayout;
  diagnostics: Diagnostic[];
};

/** Ce que `validate` et `coverage` savent d'un fichier : les deux doivent dire la même chose. */
export function analyse(file: string, text: string): Analysis {
  const root = repositoryRoot(file);
  const main = relativeTo(root, file);
  const result = parse(text, { file: main, read: createFileReader(root) });
  const layout = parseLayout(readInsideRoot(root, LAYOUT_FILE), result.pipeline);
  return {
    root,
    main,
    result,
    layout,
    diagnostics: [...result.diagnostics, ...validate(result.pipeline), ...layout.diagnostics],
  };
}
