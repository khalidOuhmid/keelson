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

  test("a directory without CI says so, naming workflows too, code 2", async () => {
    const empty = mkdtempSync(join(tmpdir(), "keelson-none-"));
    const result = await run(["validate"], { cwd: empty });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "file not found: neither .gitlab-ci.yml nor a workflow in .github/workflows",
    );
    rmSync(empty, { recursive: true });
  });

  test("a named workflow in a subdirectory, which GitHub ignores, is never read as GitLab CI", async () => {
    mkdirSync(join(root, ".github/workflows/sub"), { recursive: true });
    writeFileSync(join(root, ".github/workflows/sub/x.yml"), "a:\n  script: trivy fs .\n");
    for (const command of ["validate", "coverage", "export"]) {
      const result = await run([command, ".github/workflows/sub/x.yml"], { cwd: root });
      expect({ command, code: result.exitCode, stderr: result.stderr }).toEqual({
        command,
        code: 2,
        stderr: `keelson ${command}: .github/workflows/sub/x.yml is not a workflow GitHub runs: workflows sit directly in .github/workflows\n`,
      });
    }
    const ops = join(root, "ops.json");
    writeFileSync(ops, JSON.stringify({ kind: "removeJob", id: "a", v: 1 }));
    const applied = await run(
      ["apply", ops, "--rebase", "--file", ".github/workflows/sub/x.yml", root],
      { cwd: root },
    );
    expect(applied.exitCode).toBe(2);
    expect(applied.stderr).toContain("is not a workflow GitHub runs");
    rmSync(join(root, ".github/workflows/sub"), { recursive: true });
    rmSync(ops);
  });

  test("an unreadable workflow stops validate with its name, before any toolchain diagnostic", async () => {
    const repo = mkdtempSync(join(tmpdir(), "keelson-unreadable-"));
    mkdirSync(join(repo, ".git"));
    mkdirSync(join(repo, ".github/workflows"), { recursive: true });
    mkdirSync(join(repo, ".devsecops"));
    writeFileSync(
      join(repo, ".github/workflows/ci.yml"),
      "jobs:\n  scan:\n    steps:\n      - run: trivy fs .\n",
    );
    writeFileSync(join(repo, ".github/workflows/bad.yml"), Buffer.from([0x6a, 0x3a, 0xff, 0x0a]));
    writeFileSync(
      join(repo, ".devsecops/toolchain.yaml"),
      "version: 1\nservices:\n  n:\n    tool: nexus\nintegrations:\n  - job: publish\n    service: n\n    kind: push\n",
    );
    const result = await run(["validate"], { cwd: repo });
    expect(result).toEqual({
      stdout: "",
      stderr: `keelson validate: ${join(repo, ".github/workflows/bad.yml")} cannot be read: it is not a UTF-8 file, or not readable\n`,
      exitCode: 2,
    });
    rmSync(repo, { recursive: true });
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
