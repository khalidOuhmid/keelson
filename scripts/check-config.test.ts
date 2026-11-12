import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { biomeLintProblems, tsconfigProblems } from "./check-config.ts";
import { repoRootFrom } from "./check-runtime.ts";

const root = repoRootFrom(import.meta.url);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

describe("biome.json keeps linting on", () => {
  test("the committed biome.json declares a non-empty preset", () => {
    expect(biomeLintProblems(readJson("biome.json"))).toEqual([]);
  });

  test("`biome migrate`'s output, preset none, is refused", () => {
    expect(biomeLintProblems({ linter: { enabled: true, rules: { preset: "none" } } })).toEqual([
      'linter.rules.preset is "none": every lint rule is disabled',
    ]);
  });

  test("a missing preset is refused", () => {
    expect(biomeLintProblems({ linter: { rules: {} } })).toEqual([
      "linter.rules.preset is missing",
    ]);
    expect(biomeLintProblems({})).toEqual(["linter.rules.preset is missing"]);
  });

  test("an empty preset is refused", () => {
    expect(biomeLintProblems({ linter: { rules: { preset: "" } } })).toEqual([
      "linter.rules.preset is empty",
    ]);
  });

  test("a disabled linter is refused, whatever the preset", () => {
    expect(
      biomeLintProblems({ linter: { enabled: false, rules: { preset: "recommended" } } }),
    ).toEqual(["linter.enabled is false"]);
  });

  test("the recommended and all presets are accepted", () => {
    expect(biomeLintProblems({ linter: { rules: { preset: "recommended" } } })).toEqual([]);
    expect(biomeLintProblems({ linter: { rules: { preset: "all" } } })).toEqual([]);
  });
});

describe("tsconfig.base.json stays valid for TypeScript 7 (ADR 0014)", () => {
  test("the committed base configuration has no baseUrl and only relative paths", () => {
    expect(tsconfigProblems(readJson("tsconfig.base.json"))).toEqual([]);
  });

  test("a baseUrl is refused", () => {
    expect(tsconfigProblems({ compilerOptions: { baseUrl: "." } })).toEqual([
      "compilerOptions.baseUrl no longer exists in TypeScript 7",
    ]);
  });

  test("a path mapping that is not relative is refused", () => {
    expect(
      tsconfigProblems({ compilerOptions: { paths: { "@x/a": ["packages/a/src/index.ts"] } } }),
    ).toEqual(['compilerOptions.paths["@x/a"] is not relative: packages/a/src/index.ts']);
  });

  test("relative path mappings are accepted", () => {
    expect(
      tsconfigProblems({ compilerOptions: { paths: { "@x/a": ["./packages/a/src/index.ts"] } } }),
    ).toEqual([]);
  });

  test("the installed compiler is the one the ADR records", () => {
    const manifest = readJson("node_modules/typescript/package.json") as { version: string };
    expect(manifest.version.split(".")[0]).toBe("7");
  });
});
