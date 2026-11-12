import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalog, lowerBoundNote } from "@keelson/catalog";
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
  test("text: one line per layer, covered or not, with its jobs", async () => {
    const { stdout, exitCode } = await run(["coverage"], { cwd: tree(JOBS) });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("covered  secrets");
    expect(stdout).toContain("missing  dast");
    expect(stdout.split("\n").filter((line) => /^(covered|missing) /.test(line))).toHaveLength(21);
  });

  test("detects through an include", async () => {
    const { body } = await json(tree(JOBS));
    const sast = body.layers.find((entry: { layer: string }) => entry.layer === "sast");
    expect(sast.jobs).toEqual(["sast"]);
  });

  test("--require returns 0 when the layers are covered", async () => {
    const result = await run(["coverage", "--require", "secrets,sast"], { cwd: tree(JOBS) });
    expect(result.exitCode).toBe(0);
  });

  test("--require returns 1 and names the missing layer", async () => {
    const result = await run(["coverage", "--require", "sast,dast"], { cwd: tree(JOBS) });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      'error COVERAGE_LAYER_MISSING required layer "dast" (Dynamic testing) is not covered',
    );
    expect(result.stdout).not.toContain('required layer "sast"');
  });

  test("an unknown layer is a usage error, code 2", async () => {
    const result = await run(["coverage", "--require", "inventee"], { cwd: tree(JOBS) });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('unknown layer "inventee"');
  });

  test("the JSON carries layers, jobs, gaps and diagnostics", async () => {
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

  test("a layout.json override replaces detection", async () => {
    const layout = JSON.stringify({ version: 1, layers: { secrets: ["dast"] } });
    const { body } = await json(tree(JOBS, layout), "--require", "dast");
    expect(body.missing).toEqual([]);
    expect(body.layers.find((entry: { layer: string }) => entry.layer === "secrets").covered).toBe(
      false,
    );
  });

  test("an invalid layout.json is reported and blocks nothing", async () => {
    const { stdout, exitCode } = await run(["coverage"], { cwd: tree(JOBS, "{") });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("warning LAYOUT_INVALID");
  });

  test("a partial pipeline says so: coverage is a lower bound", async () => {
    const main = `include:\n  - template: Jobs/SAST.gitlab-ci.yml\n\n${JOBS.split("\n").slice(2).join("\n")}`;
    const { stdout } = await run(["coverage"], { cwd: tree(main) });
    expect(stdout).toContain(`partial: ${lowerBoundNote("unresolvedInclude")}`);
    expect((await json(tree(main))).body.partial).toBe(true);
  });

  /** An unreadable file says nothing about layers: reporting them all missing, code 0, would be a
   *  worse lie than an error. */
  test("invalid YAML is an error, and coverage is partial", async () => {
    const { body, exitCode } = await json(tree("a:\n  - x\n bad: [1,\n"));
    expect(exitCode).toBe(1);
    expect(body.partial).toBe(true);
    const { stdout } = await run(["coverage"], { cwd: tree("a:\n  - x\n bad: [1,\n") });
    expect(stdout).toContain(`partial: ${lowerBoundNote("invalidYaml")}`);
    expect(body.diagnostics.map((entry: { code: string }) => entry.code)).toContain("INVALID_YAML");
  });

  test("empty --require is a usage error: an empty CI variable does not disarm the gate", async () => {
    const result = await run(["coverage", "--require", ""], { cwd: tree(JOBS) });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--require");
  });

  test("missing file: code 2", async () => {
    const result = await run(["coverage"], { cwd: root });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("file not found");
  });

  test("keelson validate also reports layout.json diagnostics", async () => {
    const layout = JSON.stringify({ version: 1, layers: { absent: ["sast"] } });
    const { stdout } = await run(["validate"], { cwd: tree(JOBS, layout) });
    expect(stdout).toContain("LAYOUT_UNKNOWN_JOB");
  });
});

describe("keelson catalog lint", () => {
  const NOW = new Date("2026-11-12T00:00:00Z");

  test("the bundled catalogue is clean", async () => {
    const result = await run(["catalog", "lint"], { now: NOW, cwd: root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${loadCatalog().tools.length} tools, no findings\n`);
  });

  test("a year later, staleness is reported without failing", async () => {
    const result = await run(["catalog", "lint"], {
      now: new Date("2027-11-04T00:00:00Z"),
      cwd: root,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("warning CATALOG_STALE_TOOL");
  });

  test("a directory with an invalid catalogue entry returns 1", async () => {
    const directory = mkdtempSync(join(root, "c-"));
    writeFileSync(join(directory, "x.yaml"), "id: X\n");
    const result = await run(["catalog", "lint", directory], { now: NOW });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("x.yaml error CATALOG_INVALID_TOOL");
  });

  test("a directory without catalogue entries is a usage error, not a clean catalogue", async () => {
    const directory = mkdtempSync(join(root, "v-"));
    writeFileSync(join(directory, "x.yml"), "id: X\n");
    expect((await run(["catalog", "lint", directory], { now: NOW })).exitCode).toBe(2);
  });

  test("the repository's directory is clean", async () => {
    const tools = join(import.meta.dir, "..", "..", "catalog", "tools");
    expect((await run(["catalog", "lint", tools], { now: NOW })).exitCode).toBe(0);
  });

  test("unknown subcommand and missing directory: code 2", async () => {
    expect((await run(["catalog", "nope"], { now: NOW })).exitCode).toBe(2);
    expect((await run(["catalog", "lint", join(root, "absent")], { now: NOW })).exitCode).toBe(2);
  });
});

describe("the toolchain on the command line", () => {
  function repo(toolchain: string): string {
    const root = mkdtempSync(join(tmpdir(), "keelson-cli-tc-"));
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, ".devsecops"));
    writeFileSync(
      join(root, ".gitlab-ci.yml"),
      "stages:\n  - build\n\nbuild:\n  stage: build\n  script:\n    - make\n",
    );
    writeFileSync(join(root, ".devsecops", "toolchain.yaml"), toolchain);
    return root;
  }

  test("validate reports an unknown service and returns 1", async () => {
    const root = repo(
      "version: 1\nservices:\n  n:\n    tool: nexus\nintegrations:\n  - job: fantome\n    service: absent\n    kind: push\n",
    );
    const result = await run(["validate"], { cwd: root });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("TOOLCHAIN_UNKNOWN_SERVICE");
    expect(result.stdout).toContain("TOOLCHAIN_UNKNOWN_JOB");
  });

  test("validate returns 0 on a consistent toolchain", async () => {
    const root = repo(
      "version: 1\nservices:\n  n:\n    tool: nexus\nintegrations:\n  - job: build\n    service: n\n    kind: push\n",
    );
    expect((await run(["validate"], { cwd: root })).exitCode).toBe(0);
  });

  test("coverage --require scm is satisfied by the GitLab CI that runs the pipeline", async () => {
    const root = repo("version: 1\n");
    const result = await run(["coverage", "--require", "scm"], { cwd: root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^covered {2}scm +Source control {2}ci gitlab-ci$/m);
  });

  test("coverage --require scm is satisfied by a declared service, and says so", async () => {
    const root = repo("version: 1\nservices:\n  git:\n    tool: gitlab\n");
    const result = await run(["coverage", "--require", "scm"], { cwd: root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/covered {2}scm .*service git/);
  });
});
