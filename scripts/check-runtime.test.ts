import { describe, expect, test } from "bun:test";
import { checkRuntime, RUNTIME_PACKAGES, repoRootFrom, scanSource } from "./check-runtime.ts";

describe("scanSource", () => {
  test("reports nothing for a Node-compatible file", () => {
    const source = ['import { readFile } from "node:fs/promises";', "export const x = 1;"].join(
      "\n",
    );
    expect(scanSource("a.ts", source)).toEqual([]);
  });

  test("reports a static import of bun:", () => {
    const violations = scanSource("a.ts", 'import { test } from "bun:test";');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(1);
    expect(violations[0]?.reason).toBe("bun:");
  });

  test("reports a dynamic import of bun:", () => {
    expect(scanSource("a.ts", 'await import("bun:sqlite");')).toHaveLength(1);
  });

  test("reports a require of bun:", () => {
    expect(scanSource("a.ts", 'const x = require("bun:ffi");')).toHaveLength(1);
  });

  test("reports a reference to Bun.", () => {
    const violations = scanSource("a.ts", ["const a = 1;", "await Bun.file(a).text();"].join("\n"));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(2);
    expect(violations[0]?.reason).toBe("Bun.");
  });

  test("does not mistake an identifier containing Bun", () => {
    expect(scanSource("a.ts", "const myBun = { Bunch: 1 };")).toEqual([]);
  });

  test("reports the offending file's path", () => {
    expect(scanSource("packages/core/src/a.ts", "Bun.env;")[0]?.file).toBe(
      "packages/core/src/a.ts",
    );
  });
});

describe("checkRuntime", () => {
  test("covers the eight packages that run on the user's machine", () => {
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

  test("no Bun API in the runtime packages' src/", () => {
    expect(checkRuntime(repoRootFrom(import.meta.url))).toEqual([]);
  });
});
