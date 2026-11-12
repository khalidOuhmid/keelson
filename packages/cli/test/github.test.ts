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

describe("outside a git repository", () => {
  test("the file path is enough to pick the adapter", async () => {
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

describe("two jobs with the same name", () => {
  test("coverage keeps both", async () => {
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

describe("the CLI on GitHub Actions", () => {
  test("validate without arguments covers every workflow", async () => {
    const result = await run(["validate"], { cwd: root });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("secrets.yml");
    expect(result.stdout).toContain("UNKNOWN_NEED");
  });

  test("validate on a named file looks only at that file", async () => {
    const result = await run(["validate", ".github/workflows/ci.yml"], { cwd: root });
    expect(result.exitCode).toBe(0);
  });

  test("coverage without arguments sums the workflows", async () => {
    const result = await run(["coverage", "--require", "sca,secrets"], { cwd: root });
    expect(result.exitCode).toBe(0);
  });

  test("export merges the jobs into a single graph", async () => {
    const { stdout } = await run(["export", "--format", "mermaid"], { cwd: root });
    expect(stdout).toContain('"scan"');
    expect(stdout).toContain('"leaks"');
  });

  test("a directory without CI says so, code 2", async () => {
    const empty = mkdtempSync(join(tmpdir(), "keelson-none-"));
    expect((await run(["validate"], { cwd: empty })).exitCode).toBe(2);
    rmSync(empty, { recursive: true });
  });
});

describe("a workflow calling a local reusable workflow", () => {
  test("coverage of the caller alone counts the called jobs, and validate locates errors in it", async () => {
    const repo = mkdtempSync(join(tmpdir(), "keelson-reuse-"));
    mkdirSync(join(repo, ".git"));
    mkdirSync(join(repo, ".github/workflows"), { recursive: true });
    writeFileSync(
      join(repo, ".github/workflows/ci.yml"),
      "on: push\njobs:\n  scans:\n    uses: ./.github/workflows/scans.yml\n",
    );
    writeFileSync(
      join(repo, ".github/workflows/scans.yml"),
      "on: workflow_call\njobs:\n  leaks:\n    steps:\n      - run: gitleaks detect\n  next:\n    uses: ./.github/workflows/gone.yml\n",
    );
    const coverage = await run(["coverage", ".github/workflows/ci.yml", "--require", "secrets"], {
      cwd: repo,
    });
    expect(coverage.exitCode).toBe(0);
    const validate = await run(["validate", ".github/workflows/ci.yml"], { cwd: repo });
    expect(validate.exitCode).toBe(1);
    expect(validate.stdout).toContain(".github/workflows/scans.yml:6");
    expect(validate.stdout).toContain("WORKFLOW_CALL_INVALID");
    rmSync(repo, { recursive: true });
  });
});
