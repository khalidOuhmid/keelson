import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@keelson/adapter-gitlab";

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

process.stdout.write(`${written} goldens écrits\n`);
