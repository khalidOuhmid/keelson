import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const CORPUS_ROOT = join(dirname(here), "corpus");
export const TEMPLATES_DIR = join(CORPUS_ROOT, "gitlab-templates");
export const EDGE_CASES_DIR = join(CORPUS_ROOT, "edge-cases");

export type CorpusFile = {
  group: "gitlab-templates" | "edge-cases";
  name: string;
  path: string;
};

function filesIn(group: CorpusFile["group"], directory: string): CorpusFile[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".yml"))
    .sort()
    .map((name) => ({ group, name, path: join(directory, name) }));
}

export function corpusFiles(): CorpusFile[] {
  return [...filesIn("gitlab-templates", TEMPLATES_DIR), ...filesIn("edge-cases", EDGE_CASES_DIR)];
}

export function readCorpus(file: CorpusFile): string {
  return readFileSync(file.path, "utf8");
}

export function readEdgeCase(name: string): string {
  return readFileSync(join(EDGE_CASES_DIR, `${name}.gitlab-ci.yml`), "utf8");
}

export const INCLUDES_DIR = join(CORPUS_ROOT, "includes");

/** A tree of the includes corpus: a folder, its `.gitlab-ci.yml` at the root, and its included
 *  files. The tree is the fixture, because the shape of the defect we want to cover is "several
 *  files" — a single file would not reproduce it. */
export type CorpusTree = {
  name: string;
  root: string;
  main: string;
};

export function corpusTrees(): CorpusTree[] {
  return readdirSync(INCLUDES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      root: join(INCLUDES_DIR, name),
      main: ".gitlab-ci.yml",
    }));
}

export function readTreeMain(tree: CorpusTree): string {
  return readFileSync(join(tree.root, tree.main), "utf8");
}
