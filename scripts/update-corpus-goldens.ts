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

/** The trees of the includes corpus. This enumeration is deliberately the twin of `corpusTrees()`
 *  in `test/support/corpus.ts`: `scripts/` and `test/` are two separate TypeScript projects and
 *  neither can import the other. The divergence is **detected**, not silent — a tree this script
 *  forgot would have no golden, and `includes.golden.test.ts` fails on the missing golden. */
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

process.stdout.write(`${written} goldens written\n`);
