import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { createFileReader, readInsideRoot } from "@keelson/adapter-gitlab";
import { loadCatalog } from "@keelson/catalog";
import type { Diagnostic, Pipeline } from "@keelson/core";
import { mergePipelines, TOOLCHAIN_FILE, validate } from "@keelson/core";
import { adapterFor, detectWorkspace } from "@keelson/server";
import {
  analyseToolchain,
  LAYOUT_FILE,
  type ParsedLayout,
  parseLayout,
  type ToolchainAnalysis,
} from "@keelson/toolchain";

export const DEFAULT_FILE = ".gitlab-ci.yml";

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
  /** Les textes par chemin relatif, inclus compris : un diagnostic se situe dans le texte de son
   *  fichier. */
  texts: ReadonlyMap<string, string>;
  pipeline: Pipeline;
  /** Les diagnostics du parsing seuls : la couverture y lit qu'un fichier est illisible. */
  parsing: Diagnostic[];
  layout: ParsedLayout;
  toolchain: ToolchainAnalysis;
  diagnostics: Diagnostic[];
};

export type Target = { file: string; text: string };

/** Les fichiers d'une commande : celui qu'elle nomme, sinon tout le workspace. Rend le message
 *  d'usage si l'un d'eux manque. */
export function readTargets(
  named: string | undefined,
  cwd: string,
): { ok: true; targets: Target[] } | { ok: false; message: string } {
  const detected = named === undefined ? detectWorkspace(cwd).map((entry) => entry.path) : [];
  const paths = named !== undefined ? [named] : detected.length > 0 ? detected : [DEFAULT_FILE];

  const targets: Target[] = [];
  for (const path of paths) {
    const file = isAbsolute(path) ? path : resolve(cwd, path);
    try {
      if (!statSync(file).isFile()) {
        return { ok: false, message: `"${file}" is not a file` };
      }
      targets.push({ file, text: readFileSync(file, "utf8") });
    } catch {
      return { ok: false, message: `file not found: ${file}` };
    }
  }
  return { ok: true, targets };
}

/** Ce que `validate`, `coverage` et `export` savent des fichiers : ils doivent dire la même chose. */
export function analyse(targets: readonly Target[]): Analysis {
  const root = repositoryRoot((targets[0] as Target).file);
  const read = createFileReader(root);
  const parsed = targets.map(({ file, text }) => {
    const main = relativeTo(root, file);
    return { main, text, result: adapterFor(main).parse(text, { file: main, read }) };
  });

  const pipeline = mergePipelines(parsed.map(({ result }) => result.pipeline));
  const parsing = parsed.flatMap(({ result }) => result.diagnostics);
  const layout = parseLayout(readInsideRoot(root, LAYOUT_FILE), pipeline);
  const toolchain = analyseToolchain(
    readInsideRoot(root, TOOLCHAIN_FILE),
    pipeline,
    loadCatalog().tools,
  );

  return {
    root,
    texts: new Map(
      parsed.flatMap(({ main, text, result }) => [
        [main, text] as const,
        ...Object.entries(result.included),
      ]),
    ),
    pipeline,
    parsing,
    layout,
    toolchain,
    diagnostics: [
      ...parsed.flatMap(({ result }) => [...result.diagnostics, ...validate(result.pipeline)]),
      ...layout.diagnostics,
      ...toolchain.diagnostics,
    ],
  };
}
