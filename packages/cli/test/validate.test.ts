import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/run.ts";

let workspace = "";

function fixture(name: string, text: string): string {
  const path = join(workspace, name);
  writeFileSync(path, text);
  return path;
}

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

const WITH_ERROR = [
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

const WITH_WARNING_ONLY = ["stages:", "  - test", "", "muet:", "  stage: test", ""].join("\n");

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "keelson-validate-"));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("code de sortie", () => {
  test("0 sur un fichier sans erreur", async () => {
    expect((await run(["validate", fixture("ok.yml", VALID)])).exitCode).toBe(0);
  });

  test("0 quand il n'y a que des avertissements", async () => {
    const result = await run(["validate", fixture("warn.yml", WITH_WARNING_ONLY)]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("warning");
  });

  test("1 quand il y a au moins une erreur", async () => {
    expect((await run(["validate", fixture("ko.yml", WITH_ERROR)])).exitCode).toBe(1);
  });

  test("2 quand le fichier est introuvable", async () => {
    const result = await run(["validate", join(workspace, "fantome.yml")]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("fantome.yml");
  });

  test("2 sur un format de sortie inconnu", async () => {
    const result = await run(["validate", fixture("ok2.yml", VALID), "--format", "xml"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("xml");
  });

  test("2 quand --format est passé sans valeur", async () => {
    expect((await run(["validate", fixture("ok3.yml", VALID), "--format"])).exitCode).toBe(2);
  });

  test("2 sur une option inconnue", async () => {
    const result = await run(["validate", fixture("ok4.yml", VALID), "--strict"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--strict");
  });
});

describe("sortie texte", () => {
  test("au format fichier:ligne:colonne severity CODE message", async () => {
    const path = fixture("format.yml", WITH_ERROR);
    const lines = (await run(["validate", path])).stdout.trimEnd().split("\n");
    const diagnostic = lines.find((line) => line.includes("UNKNOWN_NEED"));
    expect(diagnostic).toMatch(/^.+:\d+:\d+ error UNKNOWN_NEED .+$/);
  });

  test("nomme le fichier analysé", async () => {
    const path = fixture("nomme.yml", WITH_ERROR);
    expect((await run(["validate", path])).stdout).toContain(path);
  });

  test("la ligne et la colonne commencent à 1", async () => {
    const path = fixture("position.yml", WITH_ERROR);
    const line = (await run(["validate", path])).stdout
      .split("\n")
      .find((candidate) => candidate.includes("UNKNOWN_NEED"));
    const match = /:(\d+):(\d+) /.exec(line ?? "");
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(1);
    expect(Number(match?.[2])).toBeGreaterThanOrEqual(1);
  });

  test("annonce l'absence de diagnostic sur un fichier sain", async () => {
    const result = await run(["validate", fixture("sain.yml", VALID)]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("aucun diagnostic");
  });

  test("cumule les diagnostics de parse et de validate", async () => {
    const melange = [
      "include:",
      "  - template: Jobs/SAST.gitlab-ci.yml",
      "",
      "stages:",
      "  - test",
      "",
      "unit:",
      "  stage: test",
      "  needs:",
      "    - absent",
      "  script:",
      "    - x",
      "",
    ].join("\n");
    const output = (await run(["validate", fixture("melange.yml", melange)])).stdout;
    expect(output).toContain("INCLUDE_UNRESOLVED");
    expect(output).toContain("UNKNOWN_NEED");
  });

  test("signale un YAML invalide", async () => {
    const output = await run(["validate", fixture("casse.yml", "a:\n  - x\n bad: [1,\n")]);
    expect(output.exitCode).toBe(1);
    expect(output.stdout).toContain("INVALID_YAML");
  });
});

describe("sortie JSON", () => {
  test("--format json rend un tableau JSON", async () => {
    const path = fixture("json.yml", WITH_ERROR);
    const parsed: unknown = JSON.parse((await run(["validate", path, "--format", "json"])).stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });

  test("chaque entrée porte file, code, severity, message, line et column", async () => {
    const path = fixture("json2.yml", WITH_ERROR);
    const parsed = JSON.parse((await run(["validate", path, "--format", "json"])).stdout) as Record<
      string,
      unknown
    >[];
    const entry = parsed.find((candidate) => candidate.code === "UNKNOWN_NEED");
    expect(entry).toBeDefined();
    expect(entry?.file).toBe(path);
    expect(entry?.severity).toBe("error");
    expect(typeof entry?.message).toBe("string");
    expect(typeof entry?.line).toBe("number");
    expect(typeof entry?.column).toBe("number");
  });

  test("un fichier sain rend un tableau vide", async () => {
    const path = fixture("json3.yml", VALID);
    expect(JSON.parse((await run(["validate", path, "--format", "json"])).stdout)).toEqual([]);
  });

  test("le code de sortie est le même qu'en texte", async () => {
    const path = fixture("json4.yml", WITH_ERROR);
    expect((await run(["validate", path, "--format", "json"])).exitCode).toBe(
      (await run(["validate", path])).exitCode,
    );
  });

  test("rien n'est écrit sur stderr quand l'analyse aboutit", async () => {
    const path = fixture("json5.yml", WITH_ERROR);
    expect((await run(["validate", path, "--format", "json"])).stderr).toBe("");
  });
});

describe("fichier par défaut", () => {
  test("cherche .gitlab-ci.yml dans le dossier courant", async () => {
    const result = await run(["validate"], { cwd: join(workspace, "vide-sans-ci") });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(".gitlab-ci.yml");
  });

  test("analyse .gitlab-ci.yml quand il est présent", async () => {
    fixture(".gitlab-ci.yml", VALID);
    expect((await run(["validate"], { cwd: workspace })).exitCode).toBe(0);
  });
});

describe("aide", () => {
  test("validate apparaît dans l'aide générale", async () => {
    expect((await run(["--help"])).stdout).toContain("validate");
  });

  test("validate n'est plus annoncée comme non implémentée", async () => {
    expect((await run(["validate", fixture("aide.yml", VALID)])).stderr).not.toContain(
      "pas encore implémentée",
    );
  });
});
