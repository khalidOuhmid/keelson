import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/run.ts";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "keelson-export-"));
  mkdirSync(join(root, ".git"));
  writeFileSync(
    join(root, ".gitlab-ci.yml"),
    "stages:\n  - build\n\nbuild:\n  stage: build\n  script:\n    - trivy fs .\n",
  );
});

afterAll(() => rmSync(root, { recursive: true }));

describe("keelson export", () => {
  test("Mermaid on standard output", async () => {
    const result = await run(["export", "--format", "mermaid"], { cwd: root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.startsWith("flowchart LR\n")).toBe(true);
  });

  test("the Markdown report by default", async () => {
    const result = await run(["export"], { cwd: root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("# Coverage report");
  });

  test("JSON: the full model", async () => {
    const result = await run(["export", "--format", "json"], { cwd: root });
    const body = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["pipeline", "coverage", "toolchain", "diagnostics"]);
  });

  test("an unknown format returns 2", async () => {
    const result = await run(["export", "--format", "pdf"], { cwd: root });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("pdf");
  });

  test("a missing file returns 2", async () => {
    expect((await run(["export", "absent.yml"], { cwd: root })).exitCode).toBe(2);
  });
});
