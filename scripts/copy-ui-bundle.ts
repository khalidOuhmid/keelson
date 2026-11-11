import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(repoRoot, "packages", "ui", "dist");
const target = join(repoRoot, "packages", "cli", "dist", "ui");

if (!existsSync(source)) {
  process.stderr.write(`bundle d'UI absent : ${source}\n`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
process.stdout.write(`UI bundle copied to ${target}\n`);
