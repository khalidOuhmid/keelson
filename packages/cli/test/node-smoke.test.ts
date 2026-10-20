import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const binary = join(packageRoot, "dist", "keelson.js");

function keelson(args: readonly string[]) {
  const result = spawnSync("node", [binary, ...args], { encoding: "utf8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status,
  };
}

beforeAll(() => {
  const build = spawnSync("bun", ["run", "build"], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  if (build.status !== 0) {
    throw new Error(`build du binaire échoué : ${build.stderr}`);
  }
});

describe("binaire buildé exécuté par node", () => {
  test("le binaire existe", () => {
    expect(existsSync(binary)).toBe(true);
  });

  test("node est bien le runtime du test", () => {
    const version = spawnSync("node", ["--version"], { encoding: "utf8" });
    expect(version.status).toBe(0);
    expect(Number.parseInt(version.stdout.trim().slice(1), 10)).toBeGreaterThanOrEqual(20);
  });

  test("--version affiche la version et sort en 0", () => {
    const result = keelson(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
  });

  test("--help liste les commandes prévues", () => {
    const result = keelson(["--help"]);
    expect(result.exitCode).toBe(0);
    for (const command of ["start", "validate", "coverage", "export"]) {
      expect(result.stdout).toContain(command);
    }
  });

  test("start sort en 2 avec le message « pas encore implémentée »", () => {
    const result = keelson(["start"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("pas encore implémentée");
  });
});
