import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(packageRoot));

type Installed = { name: string; version: string; license?: string; dependencies?: object };

function manifestOf(name: string, from: string): { path: string; json: Installed } | null {
  let directory = from;
  while (true) {
    const candidate = join(directory, "node_modules", name, "package.json");
    if (existsSync(candidate)) {
      const path = realpathSync(candidate);
      return { path, json: JSON.parse(readFileSync(path, "utf8")) as Installed };
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }
}

/** Les dépendances de production que le binaire embarque : celles de l'UI, servie par le
 *  binaire, et celles des packages runtime. Les `@types/*` ne sont que des déclarations. */
function bundled(): Map<string, string> {
  const found = new Map<string, string>();
  const visit = (name: string, from: string): void => {
    const installed = manifestOf(name, from);
    if (installed === null || found.has(installed.json.name)) {
      return;
    }
    found.set(installed.json.name, installed.json.license ?? "UNKNOWN");
    for (const dependency of Object.keys(installed.json.dependencies ?? {})) {
      visit(dependency, dirname(installed.path));
    }
  };
  for (const workspace of [
    "ui",
    "core",
    "catalog",
    "adapter-gitlab",
    "adapter-github",
    "toolchain",
  ]) {
    const directory = join(repoRoot, "packages", workspace);
    const own = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as Installed;
    for (const dependency of Object.keys(own.dependencies ?? {})) {
      if (!dependency.startsWith("@keelson/")) {
        visit(dependency, directory);
      }
    }
  }
  for (const name of [...found.keys()]) {
    if (name.startsWith("@types/")) {
      found.delete(name);
    }
  }
  return found;
}

type Manifest = {
  private?: boolean;
  version: string;
  license: string;
  bin: Record<string, string>;
  files: string[];
  dependencies?: Record<string, string>;
  repository?: { type: string; url: string };
  description: string;
};

const manifest = packageJson as unknown as Manifest;

describe("le paquet npm keelson est publiable", () => {
  test("il n'est pas privé et porte une version semver publiable", () => {
    expect(manifest.private).toBeUndefined();
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
    expect(manifest.version).not.toBe("0.0.0");
  });

  test("aucune dépendance d'exécution : tout est embarqué dans le bundle", () => {
    expect(manifest.dependencies ?? {}).toEqual({});
  });

  test("il ne publie que dist, avec un README, la licence Apache-2.0 et les mentions tierces", () => {
    expect(manifest.files).toEqual(["dist", "THIRD_PARTY_NOTICES.md"]);
    expect(readFileSync(join(packageRoot, "LICENSE"), "utf8")).toBe(
      readFileSync(join(repoRoot, "LICENSE"), "utf8"),
    );
    expect(manifest.license).toBe("Apache-2.0");
    expect(existsSync(join(packageRoot, "README.md"))).toBe(true);
    expect(readFileSync(join(packageRoot, "README.md"), "utf8")).toContain("npx keelson start");
  });

  test("le binaire pointe sur le bundle Node, et le dépôt est nommé", () => {
    expect(manifest.bin).toEqual({ keelson: "./dist/keelson.js" });
    expect(manifest.repository?.url).toContain("github.com/khalidOuhmid/keelson");
    expect(manifest.description).toMatch(/^[\x20-\x7e]+$/);
  });

  test("chaque dépendance embarquée figure dans les mentions tierces avec sa licence", () => {
    const notices = readFileSync(join(packageRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
    const dependencies = bundled();
    expect(dependencies.size).toBeGreaterThan(10);
    for (const [name, license] of dependencies) {
      expect(notices).toContain(`| \`${name}\` | ${license} |`);
    }
    expect(notices).toContain("simple-icons");
    expect(notices).toContain("CC0-1.0");
  });
});
