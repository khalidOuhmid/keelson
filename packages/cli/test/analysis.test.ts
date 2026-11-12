import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/run.ts";

const CI = "stages:\n  - build\n\nbuild:\n  stage: build\n  script:\n    - make\n";

const created: string[] = [];

afterAll(() => {
  for (const directory of created) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function repository(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), "keelson-analysis-"));
  created.push(root);
  mkdirSync(join(root, ".git"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe("the main file stays inside the repository", () => {
  function linked(): string {
    const outside = repository({ ".gitlab-ci.yml": CI });
    const root = repository({});
    symlinkSync(join(outside, ".gitlab-ci.yml"), join(root, ".gitlab-ci.yml"));
    return root;
  }

  for (const command of ["validate", "coverage", "export"]) {
    test(`${command}: a link to a file outside the root is a usage error`, async () => {
      const root = linked();
      const result = await run([command], { cwd: root });
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        `keelson ${command}: ${join(root, ".gitlab-ci.yml")} is outside the repository\n`,
      );
    });
  }

  test("a named link outside the root is refused the same way", async () => {
    const root = linked();
    const result = await run(["validate", ".gitlab-ci.yml"], { cwd: root });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("is outside the repository");
  });

  test("a link that stays inside the root is read", async () => {
    const root = repository({ "ci/main.yml": CI });
    symlinkSync(join(root, "ci", "main.yml"), join(root, ".gitlab-ci.yml"));
    const result = await run(["validate"], { cwd: root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("no diagnostics\n");
  });

  test("a CI file that is not UTF-8 is a usage error, not a silently altered text", async () => {
    const root = repository({ ".gitlab-ci.yml": Buffer.from([0x61, 0x3a, 0x20, 0xe9, 0x0a]) });
    const result = await run(["validate"], { cwd: root });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("cannot be read");
  });
});

describe("an unreadable toolchain.yaml is reported, not taken as missing", () => {
  test("a toolchain.yaml that is not UTF-8 is an error in validate", async () => {
    const root = repository({
      ".gitlab-ci.yml": CI,
      ".devsecops/toolchain.yaml": Buffer.from([0x76, 0x3a, 0x20, 0xff, 0x0a]),
    });
    const result = await run(["validate", "--format", "json"], { cwd: root });
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toContainEqual(
      expect.objectContaining({
        code: "TOOLCHAIN_INVALID",
        severity: "error",
        params: { detail: "the file cannot be read" },
      }),
    );
  });

  test("a toolchain.yaml that is a directory is an error too", async () => {
    const root = repository({ ".gitlab-ci.yml": CI });
    mkdirSync(join(root, ".devsecops", "toolchain.yaml"), { recursive: true });
    const result = await run(["validate"], { cwd: root });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("TOOLCHAIN_INVALID");
  });

  test("coverage says it as well", async () => {
    const root = repository({ ".gitlab-ci.yml": CI });
    mkdirSync(join(root, ".devsecops", "toolchain.yaml"), { recursive: true });
    const result = await run(["coverage"], { cwd: root });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("TOOLCHAIN_INVALID");
  });

  test("a missing toolchain.yaml says nothing", async () => {
    const root = repository({ ".gitlab-ci.yml": CI });
    expect((await run(["validate"], { cwd: root })).stdout).toBe("no diagnostics\n");
  });
});

describe("a toolchain job on a truncated pipeline", () => {
  test("TOOLCHAIN_UNKNOWN_JOB is a warning when a workflow could not be parsed", async () => {
    const root = repository({
      ".github/workflows/a.yml":
        "on: push\njobs:\n  build:\n    runs-on: x\n    steps:\n      - run: make\n",
      ".github/workflows/b.yml": "on: push\njobs:\n  deploy: [\n",
      ".devsecops/toolchain.yaml":
        "version: 1\nservices:\n  n:\n    tool: nexus\nintegrations:\n  - job: deploy\n    service: n\n    kind: push\n",
    });
    const result = await run(["validate", "--format", "json"], { cwd: root });
    const unknown = JSON.parse(result.stdout).find(
      (entry: { code: string }) => entry.code === "TOOLCHAIN_UNKNOWN_JOB",
    );
    expect(unknown?.severity).toBe("warning");
  });

  test("it stays an error when every file was read", async () => {
    const root = repository({
      ".gitlab-ci.yml": CI,
      ".devsecops/toolchain.yaml":
        "version: 1\nservices:\n  n:\n    tool: nexus\nintegrations:\n  - job: deploy\n    service: n\n    kind: push\n",
    });
    const result = await run(["validate"], { cwd: root });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("error TOOLCHAIN_UNKNOWN_JOB");
  });
});

describe("a service declared for a job tool", () => {
  test("is a warning that says its layers come from the declaration alone", async () => {
    const root = repository({
      ".gitlab-ci.yml": CI,
      ".devsecops/toolchain.yaml": "version: 1\nservices:\n  scanner:\n    tool: trivy\n",
    });
    const result = await run(["validate", "--format", "json"], { cwd: root });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toContainEqual(
      expect.objectContaining({
        code: "TOOLCHAIN_JOB_TOOL_AS_SERVICE",
        severity: "warning",
        params: { service: "scanner", tool: "trivy" },
      }),
    );
  });

  test("coverage lists the warning next to the layer it still covers", async () => {
    const root = repository({
      ".gitlab-ci.yml": CI,
      ".devsecops/toolchain.yaml": "version: 1\nservices:\n  scanner:\n    tool: trivy\n",
    });
    const result = await run(["coverage", "--require", "sca"], { cwd: root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("warning TOOLCHAIN_JOB_TOOL_AS_SERVICE");
  });

  test("a service tool says nothing", async () => {
    const root = repository({
      ".gitlab-ci.yml": CI,
      ".devsecops/toolchain.yaml": "version: 1\nservices:\n  n:\n    tool: nexus\n",
    });
    expect((await run(["validate"], { cwd: root })).stdout).toBe("no diagnostics\n");
  });
});
