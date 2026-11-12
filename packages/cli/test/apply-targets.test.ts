import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashText, TOOLCHAIN_FILE } from "@keelson/core";
import { applyCommand } from "../src/apply.ts";
import { run } from "../src/run.ts";

const WORKFLOW = [
  "on: push",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: make",
  "",
].join("\n");

const CI = "stages:\n  - build\n\nbuild:\n  stage: build\n  script:\n    - make\n";

const created: string[] = [];

afterAll(() => {
  for (const directory of created) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporary(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), `keelson-apply-${prefix}-`));
  created.push(directory);
  return directory;
}

function repository(files: Record<string, string>): string {
  const root = temporary("repo");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function opsFile(content: unknown): string {
  const path = join(temporary("ops"), "ops.json");
  writeFileSync(path, JSON.stringify(content));
  return path;
}

const WORKFLOW_FILE = ".github/workflows/ci.yml";

describe("a file Keelson cannot read faithfully", () => {
  test("a CI file that is not UTF-8 is refused, not rewritten with replacement characters", async () => {
    const root = temporary("latin1");
    const bytes = Buffer.concat([Buffer.from(CI), Buffer.from([0x23, 0x20, 0xe9, 0x0a])]);
    writeFileSync(join(root, ".gitlab-ci.yml"), bytes);
    const ops = { v: 1, kind: "addStage", name: "deploy" };
    const result = await run(["apply", opsFile(ops), root, "--rebase"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(
      `✗ ${root}  .gitlab-ci.yml cannot be read: it is not a UTF-8 file, or not readable\n`,
    );
    expect(readFileSync(join(root, ".gitlab-ci.yml")).equals(bytes)).toBe(true);
  });

  test("a CI path that is a directory is refused", async () => {
    const root = temporary("dir");
    mkdirSync(join(root, ".gitlab-ci.yml"));
    const result = await run([
      "apply",
      opsFile({ v: 1, kind: "addStage", name: "x" }),
      root,
      "--rebase",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(`✗ ${root}  .gitlab-ci.yml is not a file\n`);
  });
});

describe("a concurrent write", () => {
  test("a change on disk between the read and the write is refused as stale, and kept", async () => {
    const root = repository({ ".gitlab-ci.yml": CI });
    const concurrent = `${CI}\n# edited meanwhile\n`;
    const ops = { v: 1, baseHash: hashText(CI), kind: "addStage", name: "deploy" };
    const result = await applyCommand([opsFile(ops), root, "--json"], root, {
      beforeWrite: (at, file) => writeFileSync(join(at, file), concurrent),
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).results[0].error).toEqual({
      code: "STALE_DOCUMENT",
      params: { expected: hashText(concurrent), received: hashText(CI) },
      message: "the document changed since the operation was computed",
    });
    expect(readFileSync(join(root, ".gitlab-ci.yml"), "utf8")).toBe(concurrent);
  });

  test("a toolchain created meanwhile is not overwritten", async () => {
    const root = repository({ ".gitlab-ci.yml": CI });
    const concurrent = "version: 1\nservices:\n  vault:\n    tool: vault\n";
    const ops = { v: 1, kind: "addService", id: "n", tool: "nexus", url: null, environment: null };
    const result = await applyCommand(
      [opsFile(ops), root, "--file", TOOLCHAIN_FILE, "--rebase"],
      root,
      {
        beforeWrite: (at, file) => {
          mkdirSync(join(at, ".devsecops"), { recursive: true });
          writeFileSync(join(at, file), concurrent);
        },
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(
      `✗ ${root}  the document changed since the operation was computed\n`,
    );
    expect(readFileSync(join(root, TOOLCHAIN_FILE), "utf8")).toBe(concurrent);
  });

  test("an unchanged disk is written as before", async () => {
    const root = repository({ ".gitlab-ci.yml": CI });
    let called = 0;
    const ops = { v: 1, baseHash: hashText(CI), kind: "addStage", name: "deploy" };
    const result = await applyCommand([opsFile(ops), root], root, {
      beforeWrite: () => {
        called += 1;
      },
    });
    expect(result.exitCode).toBe(0);
    expect(called).toBe(1);
    expect(readFileSync(join(root, ".gitlab-ci.yml"), "utf8")).toContain("  - deploy\n");
  });
});

describe("a GitHub Actions workflow", () => {
  test("--file on a workflow edits it through the GitHub adapter", async () => {
    const root = repository({ [WORKFLOW_FILE]: WORKFLOW });
    const ops = {
      v: 1,
      baseHash: hashText(WORKFLOW),
      kind: "addNeed",
      id: "build",
      need: { job: "lint" },
    };
    const added = {
      v: 1,
      baseHash: hashText(WORKFLOW),
      kind: "addJob",
      job: { id: "lint", stage: "build", script: ["npm run lint"] },
    };
    const result = await run([
      "apply",
      opsFile([added, ops]),
      root,
      "--file",
      WORKFLOW_FILE,
      "--rebase",
    ]);

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`✓ ${root}  2 operation(s) applied\n`);
    expect(result.exitCode).toBe(0);
    const text = readFileSync(join(root, WORKFLOW_FILE), "utf8");
    expect(text).toContain("  lint:\n");
    expect(text).toContain("npm run lint");
    expect(text).toMatch(/needs:.*lint/s);
    const validated = await run(["validate", WORKFLOW_FILE], { cwd: root });
    expect(validated.stdout).not.toContain("error");
  });

  test("an operation GitHub Actions has no equivalent for fails with the adapter's message", async () => {
    const root = repository({ [WORKFLOW_FILE]: WORKFLOW });
    const ops = { v: 1, kind: "addStage", name: "deploy" };
    const result = await run([
      "apply",
      opsFile(ops),
      root,
      "--file",
      WORKFLOW_FILE,
      "--rebase",
      "--json",
    ]);

    expect(result.exitCode).toBe(1);
    const [entry] = JSON.parse(result.stdout).results;
    expect(entry.ok).toBe(false);
    expect(entry.error.kind).toBe("addStage");
    expect(readFileSync(join(root, WORKFLOW_FILE), "utf8")).toBe(WORKFLOW);
  });

  test("--dry-run shows the workflow diff and writes nothing", async () => {
    const root = repository({ [WORKFLOW_FILE]: WORKFLOW });
    const ops = { v: 1, kind: "removeJob", id: "build" };
    const result = await run([
      "apply",
      opsFile(ops),
      root,
      "--file",
      WORKFLOW_FILE,
      "--rebase",
      "--dry-run",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`--- ${root}/${WORKFLOW_FILE}`);
    expect(result.stdout).toContain("-  build:");
    expect(readFileSync(join(root, WORKFLOW_FILE), "utf8")).toBe(WORKFLOW);
  });
});

describe("the toolchain", () => {
  const addService = {
    v: 1,
    kind: "addService",
    id: "nexus",
    tool: "nexus",
    url: "https://nexus.example.com",
    environment: null,
  };
  const addIntegration = {
    v: 1,
    kind: "addIntegration",
    job: "build",
    service: "nexus",
    integration: "push",
  };

  test("toolchain operations on .devsecops/toolchain.yaml create the file in each repository", async () => {
    const first = repository({ ".gitlab-ci.yml": CI });
    const second = repository({ ".gitlab-ci.yml": CI });
    const result = await run([
      "apply",
      opsFile([addService, addIntegration]),
      first,
      second,
      "--file",
      TOOLCHAIN_FILE,
      "--rebase",
    ]);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    for (const root of [first, second]) {
      const text = readFileSync(join(root, TOOLCHAIN_FILE), "utf8");
      expect(text).toContain("nexus:");
      expect(text).toContain("job: build");
      expect((await run(["validate"], { cwd: root })).exitCode).toBe(0);
    }
    expect(readdirSync(join(first, ".devsecops"))).toEqual(["toolchain.yaml"]);
  });

  test("an anchored toolchain operation is checked against the file's hash", async () => {
    const existing = "version: 1\nservices: {}\n";
    const root = repository({ [TOOLCHAIN_FILE]: existing });
    const stale = { ...addService, baseHash: hashText("something else") };
    const result = await run(["apply", opsFile(stale), root, "--file", TOOLCHAIN_FILE, "--json"]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).results[0].error.code).toBe("STALE_DOCUMENT");
    expect(readFileSync(join(root, TOOLCHAIN_FILE), "utf8")).toBe(existing);
  });

  test("an absent toolchain is anchored on the empty text", async () => {
    const root = repository({ ".gitlab-ci.yml": CI });
    const anchored = { ...addService, baseHash: hashText("") };
    const result = await run(["apply", opsFile(anchored), root, "--file", TOOLCHAIN_FILE]);

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(root, TOOLCHAIN_FILE))).toBe(true);
  });

  test("--dry-run on the toolchain writes nothing, not even the directory", async () => {
    const root = repository({ ".gitlab-ci.yml": CI });
    const result = await run([
      "apply",
      opsFile(addService),
      root,
      "--file",
      TOOLCHAIN_FILE,
      "--rebase",
      "--dry-run",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("+services:");
    expect(existsSync(join(root, ".devsecops"))).toBe(false);
  });

  test("a CI operation on the toolchain is a usage error naming its kind", async () => {
    const root = repository({ ".gitlab-ci.yml": CI });
    const ops = { v: 1, kind: "addStage", name: "deploy" };
    const result = await run(["apply", opsFile(ops), root, "--file", TOOLCHAIN_FILE, "--rebase"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toStartWith("keelson apply: operation: ");
    expect(existsSync(join(root, ".devsecops"))).toBe(false);
  });

  test("a toolchain operation on a CI file is a usage error", async () => {
    const root = repository({ ".gitlab-ci.yml": CI });
    const result = await run(["apply", opsFile(addService), root, "--rebase"]);

    expect(result.exitCode).toBe(2);
    expect(readFileSync(join(root, ".gitlab-ci.yml"), "utf8")).toBe(CI);
  });

  test("a .devsecops that is a regular file is reported as such", async () => {
    const root = repository({ ".gitlab-ci.yml": CI, ".devsecops": "not a directory\n" });
    const result = await run([
      "apply",
      opsFile(addService),
      root,
      "--file",
      TOOLCHAIN_FILE,
      "--rebase",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(`✗ ${root}  .devsecops is not a directory\n`);
    expect(readFileSync(join(root, ".devsecops"), "utf8")).toBe("not a directory\n");
  });
});
