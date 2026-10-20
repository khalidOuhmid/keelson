import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

describe("validate sous node", () => {
  const VALID = [
    "stages:",
    "  - build",
    "  - test",
    "",
    "compile:",
    "  stage: build",
    "  script:",
    "    - make",
    "",
    "unit:",
    "  stage: test",
    "  needs:",
    "    - compile",
    "  script:",
    "    - make check",
    "",
  ].join("\n");

  const INVALID = [
    "stages:",
    "  - test",
    "",
    "unit:",
    "  stage: test",
    "  needs:",
    "    - absent",
    "  script:",
    "    - make check",
    "",
  ].join("\n");

  let workspace = "";

  beforeAll(() => {
    workspace = mkdtempSync(join(tmpdir(), "keelson-node-smoke-"));
    writeFileSync(join(workspace, "valide.yml"), VALID);
    writeFileSync(join(workspace, "invalide.yml"), INVALID);
  });

  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  test("sort en 0 sur une fixture valide", () => {
    const result = keelson(["validate", join(workspace, "valide.yml")]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("aucun diagnostic");
  });

  test("sort en 1 sur une fixture invalide en nommant le code", () => {
    const result = keelson(["validate", join(workspace, "invalide.yml")]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("UNKNOWN_NEED");
  });

  test("--format json rend du JSON analysable par node", () => {
    const result = keelson(["validate", join(workspace, "invalide.yml"), "--format", "json"]);
    const parsed = JSON.parse(result.stdout) as { code: string }[];
    expect(parsed.some((entry) => entry.code === "UNKNOWN_NEED")).toBe(true);
  });

  test("sort en 2 quand le fichier est introuvable", () => {
    expect(keelson(["validate", join(workspace, "fantome.yml")]).exitCode).toBe(2);
  });

  test("le bundle node embarque yaml et zod sans dependance externe", () => {
    const result = keelson(["validate", join(workspace, "valide.yml")]);
    expect(result.stderr).not.toContain("Cannot find module");
  });
});
