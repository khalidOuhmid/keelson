import { describe, expect, test } from "bun:test";
import { checkRuntime, RUNTIME_PACKAGES, repoRootFrom, scanSource } from "./check-runtime.ts";

describe("scanSource", () => {
  test("ne signale rien pour un fichier compatible Node", () => {
    const source = ['import { readFile } from "node:fs/promises";', "export const x = 1;"].join(
      "\n",
    );
    expect(scanSource("a.ts", source)).toEqual([]);
  });

  test("signale un import statique de bun:", () => {
    const violations = scanSource("a.ts", 'import { test } from "bun:test";');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(1);
    expect(violations[0]?.reason).toBe("bun:");
  });

  test("signale un import dynamique de bun:", () => {
    expect(scanSource("a.ts", 'await import("bun:sqlite");')).toHaveLength(1);
  });

  test("signale un require de bun:", () => {
    expect(scanSource("a.ts", 'const x = require("bun:ffi");')).toHaveLength(1);
  });

  test("signale une référence à Bun.", () => {
    const violations = scanSource("a.ts", ["const a = 1;", "await Bun.file(a).text();"].join("\n"));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(2);
    expect(violations[0]?.reason).toBe("Bun.");
  });

  test("ne confond pas un identifiant qui contient Bun", () => {
    expect(scanSource("a.ts", "const myBun = { Bunch: 1 };")).toEqual([]);
  });

  test("rapporte le chemin du fichier fautif", () => {
    expect(scanSource("packages/core/src/a.ts", "Bun.env;")[0]?.file).toBe(
      "packages/core/src/a.ts",
    );
  });
});

describe("checkRuntime", () => {
  test("couvre les huit packages exécutés chez l'utilisateur", () => {
    expect([...RUNTIME_PACKAGES].sort()).toEqual([
      "adapter-github",
      "adapter-gitlab",
      "catalog",
      "cli",
      "core",
      "server",
      "taxonomy",
      "toolchain",
    ]);
  });

  test("aucune API Bun dans les src/ des packages runtime", () => {
    expect(checkRuntime(repoRootFrom(import.meta.url))).toEqual([]);
  });
});
