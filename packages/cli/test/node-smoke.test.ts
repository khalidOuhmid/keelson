import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    throw new Error(`binary build failed: ${build.stderr}`);
  }
});

describe("built binary run by node", () => {
  test("the binary exists", () => {
    expect(existsSync(binary)).toBe(true);
  });

  test("node is indeed the test runtime", () => {
    const version = spawnSync("node", ["--version"], { encoding: "utf8" });
    expect(version.status).toBe(0);
    expect(Number.parseInt(version.stdout.trim().slice(1), 10)).toBeGreaterThanOrEqual(20);
  });

  test("--version prints the version and exits 0", () => {
    const result = keelson(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
  });

  test("--help lists the planned commands", () => {
    const result = keelson(["--help"]);
    expect(result.exitCode).toBe(0);
    for (const command of ["start", "validate", "coverage", "catalog", "export", "apply"]) {
      expect(result.stdout).toContain(command);
    }
  });

  test("export responds under Node", () => {
    const result = keelson(["export", "/chemin/absent.yml"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("file not found");
  });
});

describe("validate under node", () => {
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

  test("exits 0 on a valid fixture", () => {
    const result = keelson(["validate", join(workspace, "valide.yml")]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("no diagnostics");
  });

  test("exits 1 on an invalid fixture, naming the code", () => {
    const result = keelson(["validate", join(workspace, "invalide.yml")]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("UNKNOWN_NEED");
  });

  test("--format json yields JSON node can parse", () => {
    const result = keelson(["validate", join(workspace, "invalide.yml"), "--format", "json"]);
    const parsed = JSON.parse(result.stdout) as { code: string }[];
    expect(parsed.some((entry) => entry.code === "UNKNOWN_NEED")).toBe(true);
  });

  test("exits 2 when the file is not found", () => {
    expect(keelson(["validate", join(workspace, "fantome.yml")]).exitCode).toBe(2);
  });

  test("the node bundle embeds yaml and zod with no external dependency", () => {
    const result = keelson(["validate", join(workspace, "valide.yml")]);
    expect(result.stderr).not.toContain("Cannot find module");
  });
});

describe("apply under node", () => {
  let repo = "";

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "keelson-apply-smoke-"));
    writeFileSync(join(repo, ".gitlab-ci.yml"), "stages:\n  - build\n");
    writeFileSync(
      join(repo, "ops.json"),
      JSON.stringify({ v: 1, baseHash: "0".repeat(64), kind: "addStage", name: "deploy" }),
    );
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test("writes the file atomically and exits 0", () => {
    const result = keelson(["apply", join(repo, "ops.json"), repo, "--rebase"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`✓ ${repo}  1 operation(s) applied\n`);
    expect(readFileSync(join(repo, ".gitlab-ci.yml"), "utf8")).toBe(
      "stages:\n  - build\n  - deploy\n",
    );
  });
});

describe("start under node", () => {
  type Running = {
    child: ReturnType<typeof spawn>;
    url: string;
    exit: Promise<number | null>;
  };

  async function start(args: readonly string[], cwd: string): Promise<Running> {
    const child = spawn("node", [binary, "start", ...args], { cwd, stdio: "pipe" });
    let stdout = "";

    const exit = new Promise<number | null>((resolve) => {
      child.on("exit", (code) => resolve(code));
    });

    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no URL; stdout=${stdout}`)), 15_000);
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        const match = /(http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]{64})/.exec(stdout);
        if (match?.[1] !== undefined) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.on("exit", () => {
        clearTimeout(timer);
        reject(new Error(`the process exited before announcing its URL; stdout=${stdout}`));
      });
    });

    return { child, url, exit };
  }

  let root = "";

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "keelson-start-smoke-"));
    writeFileSync(
      join(root, ".gitlab-ci.yml"),
      [
        "stages:",
        "  - build",
        "",
        "compile:",
        "  stage: build",
        "  script:",
        "    - make",
        "",
      ].join("\n"),
    );
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("announces its URL, answers /api/workspace, then exits 0 on SIGINT", async () => {
    const running = await start(["--no-open", "--port", "0"], root);

    const url = new URL(running.url);
    expect(url.hostname).toBe("127.0.0.1");

    const response = await fetch(`${url.origin}/api/workspace`, {
      headers: { "x-keelson-token": url.searchParams.get("token") ?? "" },
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toEqual({
      files: [{ path: ".gitlab-ci.yml", adapter: "gitlab" }],
    });

    running.child.kill("SIGINT");
    expect(await running.exit).toBe(0);
  }, 30_000);

  test("serves the UI bundle embedded in dist/ui", async () => {
    const running = await start(["--no-open", "--port", "0"], root);
    const url = new URL(running.url);

    const page = await fetch(`${url.origin}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain('<div id="root">');

    running.child.kill("SIGINT");
    expect(await running.exit).toBe(0);
  }, 30_000);

  test("refuses an API request without a token", async () => {
    const running = await start(["--no-open", "--port", "0"], root);
    const url = new URL(running.url);

    expect((await fetch(`${url.origin}/api/workspace`)).status).toBe(403);

    running.child.kill("SIGTERM");
    expect(await running.exit).toBe(0);
  }, 30_000);
});
