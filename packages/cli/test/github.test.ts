import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/run.ts";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "keelson-cli-gh-"));
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(
    join(root, ".github/workflows/ci.yml"),
    "on: push\njobs:\n  scan:\n    runs-on: ubuntu-latest\n    steps:\n      - run: trivy fs .\n",
  );
  writeFileSync(
    join(root, ".github/workflows/secrets.yml"),
    "on: push\njobs:\n  leaks:\n    needs: fantome\n    runs-on: ubuntu-latest\n    steps:\n      - uses: gitleaks/gitleaks-action@v2\n",
  );
});

afterAll(() => rmSync(root, { recursive: true }));

describe("hors d'un dépôt git", () => {
  test("le chemin du fichier suffit à choisir l'adaptateur", async () => {
    const bare = mkdtempSync(join(tmpdir(), "keelson-bare-"));
    mkdirSync(join(bare, ".github/workflows"), { recursive: true });
    writeFileSync(
      join(bare, ".github/workflows/one.yml"),
      "jobs:\n  a:\n    runs-on: x\n    steps:\n      - run: trivy fs .\n",
    );
    const result = await run(["validate", ".github/workflows/one.yml"], { cwd: bare });
    expect(result.stdout).toBe("no diagnostics\n");
    expect((await run(["coverage", "--require", "sca"], { cwd: bare })).exitCode).toBe(0);
    rmSync(bare, { recursive: true });
  });
});

describe("deux jobs de même nom", () => {
  test("coverage garde les deux", async () => {
    const twin = mkdtempSync(join(tmpdir(), "keelson-twin-"));
    mkdirSync(join(twin, ".git"));
    mkdirSync(join(twin, ".github/workflows"), { recursive: true });
    writeFileSync(
      join(twin, ".github/workflows/a.yml"),
      "jobs:\n  scan:\n    steps:\n      - run: gitleaks detect\n",
    );
    writeFileSync(
      join(twin, ".github/workflows/b.yml"),
      "jobs:\n  scan:\n    steps:\n      - run: trivy fs .\n",
    );
    expect((await run(["coverage", "--require", "sca,secrets"], { cwd: twin })).exitCode).toBe(0);
    rmSync(twin, { recursive: true });
  });
});

describe("la CLI sur GitHub Actions", () => {
  test("validate sans argument couvre tous les workflows", async () => {
    const result = await run(["validate"], { cwd: root });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("secrets.yml");
    expect(result.stdout).toContain("UNKNOWN_NEED");
  });

  test("validate sur un fichier nommé ne regarde que lui", async () => {
    const result = await run(["validate", ".github/workflows/ci.yml"], { cwd: root });
    expect(result.exitCode).toBe(0);
  });

  test("coverage sans argument additionne les workflows", async () => {
    const result = await run(["coverage", "--require", "sca,secrets"], { cwd: root });
    expect(result.exitCode).toBe(0);
  });

  test("export fusionne les jobs dans un seul graphe", async () => {
    const { stdout } = await run(["export", "--format", "mermaid"], { cwd: root });
    expect(stdout).toContain('"scan"');
    expect(stdout).toContain('"leaks"');
  });

  test("un dossier sans CI le dit, code 2", async () => {
    const empty = mkdtempSync(join(tmpdir(), "keelson-none-"));
    expect((await run(["validate"], { cwd: empty })).exitCode).toBe(2);
    rmSync(empty, { recursive: true });
  });
});
