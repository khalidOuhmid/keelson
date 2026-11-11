import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

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

  test("il ne publie que dist, avec un README et la licence Apache-2.0", () => {
    expect(manifest.files).toEqual(["dist"]);
    expect(manifest.license).toBe("Apache-2.0");
    expect(existsSync(join(packageRoot, "README.md"))).toBe(true);
    expect(readFileSync(join(packageRoot, "README.md"), "utf8")).toContain("npx keelson start");
  });

  test("le binaire pointe sur le bundle Node, et le dépôt est nommé", () => {
    expect(manifest.bin).toEqual({ keelson: "./dist/keelson.js" });
    expect(manifest.repository?.url).toContain("github.com/khalidOuhmid/keelson");
    expect(manifest.description).toMatch(/^[\x20-\x7e]+$/);
  });
});
