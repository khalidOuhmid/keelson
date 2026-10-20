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
