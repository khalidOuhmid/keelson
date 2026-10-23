import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFileReader, parse } from "@keelson/adapter-gitlab";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const corpus = join(repoRoot, "packages", "adapter-gitlab", "test", "corpus");
const groups = ["gitlab-templates", "edge-cases"] as const;

let written = 0;

for (const group of groups) {
  const source = join(corpus, group);
  const target = join(corpus, "goldens", group);
  mkdirSync(target, { recursive: true });

  for (const name of readdirSync(source)
    .filter((entry) => entry.endsWith(".yml"))
    .sort()) {
    const text = readFileSync(join(source, name), "utf8");
    const { pipeline } = parse(text);
    writeFileSync(
      join(target, `${name}.expected.ir.json`),
      `${JSON.stringify(pipeline, null, 2)}\n`,
    );
    written += 1;
  }
}

/** Les arbres du corpus d'includes. Cette énumération est volontairement la jumelle de
 *  `corpusTrees()` dans `test/support/corpus.ts` : `scripts/` et `test/` sont deux projets
 *  TypeScript distincts et l'un ne peut pas importer l'autre. La divergence est **détectée** et non
 *  silencieuse — un arbre que ce script oublierait n'aurait pas de golden, et
 *  `includes.golden.test.ts` échoue sur le golden manquant. */
const MAIN = ".gitlab-ci.yml";
const treeSource = join(corpus, "includes");
const treeTarget = join(corpus, "goldens", "includes");
mkdirSync(treeTarget, { recursive: true });

for (const entry of readdirSync(treeSource, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  const root = join(treeSource, entry.name);
  const { pipeline } = parse(readFileSync(join(root, MAIN), "utf8"), {
    file: MAIN,
    read: createFileReader(root),
  });
  writeFileSync(
    join(treeTarget, `${entry.name}.expected.ir.json`),
    `${JSON.stringify(pipeline, null, 2)}\n`,
  );
  written += 1;
}

process.stdout.write(`${written} goldens écrits\n`);
