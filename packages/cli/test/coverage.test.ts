import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalog } from "@keelson/catalog";
import { run } from "../src/run.ts";

let root = "";

const JOBS = [
  "include: /ci/sast.yml",
  "",
  "stages:",
  "  - test",
  "",
  "secrets:",
  "  stage: test",
  "  image: ghcr.io/gitleaks/gitleaks:latest",
  "  script:",
  "    - gitleaks git",
  "",
].join("\n");

function tree(main: string, layout?: string): string {
  const directory = mkdtempSync(join(root, "t-"));
  mkdirSync(join(directory, "ci"));
  writeFileSync(
    join(directory, "ci", "sast.yml"),
    "sast:\n  stage: test\n  script:\n    - semgrep ci\n",
  );
  writeFileSync(join(directory, ".gitlab-ci.yml"), main);
  if (layout !== undefined) {
    mkdirSync(join(directory, ".devsecops"));
    writeFileSync(join(directory, ".devsecops", "layout.json"), layout);
  }
  return directory;
}

async function json(cwd: string, ...args: string[]) {
  const result = await run(["coverage", ...args, "--format", "json"], { cwd });
  return { ...result, body: JSON.parse(result.stdout) };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "keelson-coverage-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("keelson coverage", () => {
  test("texte : une ligne par couche, couverte ou non, avec ses jobs", async () => {
    const { stdout, exitCode } = await run(["coverage"], { cwd: tree(JOBS) });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("covered  secrets");
    expect(stdout).toContain("missing  dast");
    expect(stdout.split("\n").filter((line) => /^(covered|missing) /.test(line))).toHaveLength(21);
  });

  test("détecte à travers un include", async () => {
    const { body } = await json(tree(JOBS));
    const sast = body.layers.find((entry: { layer: string }) => entry.layer === "sast");
    expect(sast.jobs).toEqual(["sast"]);
  });

  test("--require rend 0 quand les couches sont couvertes", async () => {
    const result = await run(["coverage", "--require", "secrets,sast"], { cwd: tree(JOBS) });
    expect(result.exitCode).toBe(0);
  });

  test("--require rend 1 et nomme la couche manquante", async () => {
    const result = await run(["coverage", "--require", "sast,dast"], { cwd: tree(JOBS) });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      'error COVERAGE_LAYER_MISSING required layer "dast" (Dynamic testing) is not covered',
    );
    expect(result.stdout).not.toContain('required layer "sast"');
  });

  test("une couche inconnue est une erreur d'usage, code 2", async () => {
    const result = await run(["coverage", "--require", "inventee"], { cwd: tree(JOBS) });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('unknown layer "inventee"');
  });

  test("le JSON porte couches, jobs, manques et diagnostics", async () => {
    const { body, exitCode } = await json(tree(JOBS), "--require", "dast");
    expect(exitCode).toBe(1);
    expect(Object.keys(body).sort()).toEqual([
      "diagnostics",
      "jobs",
      "layers",
      "missing",
      "partial",
    ]);
    expect(body.missing).toEqual([{ layer: "dast", name: "Dynamic testing" }]);
    expect(body.diagnostics[0].message).toContain("is not covered");
  });

  test("une surcharge de layout.json remplace la détection", async () => {
    const layout = JSON.stringify({ version: 1, layers: { secrets: ["dast"] } });
    const { body } = await json(tree(JOBS, layout), "--require", "dast");
    expect(body.missing).toEqual([]);
    expect(body.layers.find((entry: { layer: string }) => entry.layer === "secrets").covered).toBe(
      false,
    );
  });

  test("un layout.json invalide est signalé et n'empêche rien", async () => {
    const { stdout, exitCode } = await run(["coverage"], { cwd: tree(JOBS, "{") });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("warning LAYOUT_INVALID");
  });

  test("un pipeline partiel le dit : la couverture est une borne basse", async () => {
    const main = `include:\n  - template: Jobs/SAST.gitlab-ci.yml\n\n${JOBS.split("\n").slice(2).join("\n")}`;
    const { stdout } = await run(["coverage"], { cwd: tree(main) });
    expect(stdout).toContain(
      "partial: some includes are not resolved, so coverage is a lower bound",
    );
    expect((await json(tree(main))).body.partial).toBe(true);
  });

  /** Un fichier illisible ne dit rien des couches : les annoncer toutes manquantes, code 0, serait
   *  un mensonge plus grave qu'une erreur. */
  test("un YAML invalide est une erreur, et la couverture est partielle", async () => {
    const { body, exitCode } = await json(tree("a:\n  - x\n bad: [1,\n"));
    expect(exitCode).toBe(1);
    expect(body.partial).toBe(true);
    expect(body.diagnostics.map((entry: { code: string }) => entry.code)).toContain("INVALID_YAML");
  });

  test("--require vide est une erreur d'usage : une variable de CI vide ne désarme pas la barrière", async () => {
    const result = await run(["coverage", "--require", ""], { cwd: tree(JOBS) });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--require");
  });

  test("fichier absent : code 2", async () => {
    const result = await run(["coverage"], { cwd: root });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("file not found");
  });

  test("keelson validate rapporte aussi les diagnostics de layout.json", async () => {
    const layout = JSON.stringify({ version: 1, layers: { absent: ["sast"] } });
    const { stdout } = await run(["validate"], { cwd: tree(JOBS, layout) });
    expect(stdout).toContain("LAYOUT_UNKNOWN_JOB");
  });
});

describe("keelson catalog lint", () => {
  const NOW = new Date("2026-11-04T00:00:00Z");

  test("le catalogue embarqué est propre", async () => {
    const result = await run(["catalog", "lint"], { now: NOW, cwd: root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${loadCatalog().tools.length} tools, no findings\n`);
  });

  test("un an plus tard, la fraîcheur est signalée sans échouer", async () => {
    const result = await run(["catalog", "lint"], {
      now: new Date("2027-11-04T00:00:00Z"),
      cwd: root,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("warning CATALOG_STALE_TOOL");
  });

  test("un dossier avec une fiche invalide rend 1", async () => {
    const directory = mkdtempSync(join(root, "c-"));
    writeFileSync(join(directory, "x.yaml"), "id: X\n");
    const result = await run(["catalog", "lint", directory], { now: NOW });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("x.yaml error CATALOG_INVALID_TOOL");
  });

  test("un dossier sans fiche est une erreur d'usage, pas un catalogue propre", async () => {
    const directory = mkdtempSync(join(root, "v-"));
    writeFileSync(join(directory, "x.yml"), "id: X\n");
    expect((await run(["catalog", "lint", directory], { now: NOW })).exitCode).toBe(2);
  });

  test("le dossier du dépôt est propre", async () => {
    const tools = join(import.meta.dir, "..", "..", "catalog", "tools");
    expect((await run(["catalog", "lint", tools], { now: NOW })).exitCode).toBe(0);
  });

  test("sous-commande inconnue et dossier absent : code 2", async () => {
    expect((await run(["catalog", "nope"], { now: NOW })).exitCode).toBe(2);
    expect((await run(["catalog", "lint", join(root, "absent")], { now: NOW })).exitCode).toBe(2);
  });
});
