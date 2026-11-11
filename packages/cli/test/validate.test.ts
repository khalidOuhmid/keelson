import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

describe("exit code", () => {
  test("0 on a file without errors", async () => {
    expect((await run(["validate", fixture("ok.yml", VALID)])).exitCode).toBe(0);
  });

  test("0 when there are only warnings", async () => {
    const result = await run(["validate", fixture("warn.yml", WITH_WARNING_ONLY)]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("warning");
  });

  test("1 when there is at least one error", async () => {
    expect((await run(["validate", fixture("ko.yml", WITH_ERROR)])).exitCode).toBe(1);
  });

  test("2 when the file is not found", async () => {
    const result = await run(["validate", join(workspace, "fantome.yml")]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("fantome.yml");
  });

  test("2 on an unknown output format", async () => {
    const result = await run(["validate", fixture("ok2.yml", VALID), "--format", "xml"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("xml");
  });

  test("2 when --format is passed without a value", async () => {
    expect((await run(["validate", fixture("ok3.yml", VALID), "--format"])).exitCode).toBe(2);
  });

  test("2 on an unknown option", async () => {
    const result = await run(["validate", fixture("ok4.yml", VALID), "--strict"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--strict");
  });
});

describe("text output", () => {
  test("in file:line:column severity CODE message format", async () => {
    const path = fixture("format.yml", WITH_ERROR);
    const lines = (await run(["validate", path])).stdout.trimEnd().split("\n");
    const diagnostic = lines.find((line) => line.includes("UNKNOWN_NEED"));
    expect(diagnostic).toMatch(/^.+:\d+:\d+ error UNKNOWN_NEED .+$/);
  });

  test("names the analysed file", async () => {
    const path = fixture("nomme.yml", WITH_ERROR);
    expect((await run(["validate", path])).stdout).toContain(path);
  });

  test("line and column start at 1", async () => {
    const path = fixture("position.yml", WITH_ERROR);
    const line = (await run(["validate", path])).stdout
      .split("\n")
      .find((candidate) => candidate.includes("UNKNOWN_NEED"));
    const match = /:(\d+):(\d+) /.exec(line ?? "");
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(1);
    expect(Number(match?.[2])).toBeGreaterThanOrEqual(1);
  });

  test("announces there are no diagnostics on a healthy file", async () => {
    const result = await run(["validate", fixture("sain.yml", VALID)]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("no diagnostics");
  });

  test("combines parse and validate diagnostics", async () => {
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

  test("reports invalid YAML", async () => {
    const output = await run(["validate", fixture("casse.yml", "a:\n  - x\n bad: [1,\n")]);
    expect(output.exitCode).toBe(1);
    expect(output.stdout).toContain("INVALID_YAML");
  });

  /** The CLI no longer words anything itself: each line is `render(code, params)`. The test covers
   *  one family per origin — parse, extends resolution, validation — so that `params` substitution
   *  is checked on the real path, not only in the registry. */
  test("renders the English text of each diagnostic family", async () => {
    const melange = [
      "include:",
      "  - template: Jobs/SAST.gitlab-ci.yml",
      "",
      "stages:",
      "  - build",
      "  - test",
      "",
      "muet:",
      "  stage: build",
      "",
      "orphelin:",
      "  stage: test",
      "  extends: .absent",
      "  script: a",
      "",
      "unit:",
      "  stage: test",
      "  needs:",
      "    - introuvable",
      "  script: b",
      "",
    ].join("\n");

    const output = (await run(["validate", fixture("anglais.yml", melange)])).stdout;
    expect(output).toContain(
      "this template include is not resolved (Jobs/SAST.gitlab-ci.yml), so the pipeline shown may be incomplete",
    );
    expect(output).toContain('extends target ".absent" does not exist in any resolved file');
    expect(output).toContain('job "muet" has no script, no run and no trigger');
    expect(output).toContain('job "unit" needs "introuvable", which does not exist');
  });
});

describe("JSON output", () => {
  test("--format json returns a JSON array", async () => {
    const path = fixture("json.yml", WITH_ERROR);
    const parsed: unknown = JSON.parse((await run(["validate", path, "--format", "json"])).stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });

  test("each entry carries file, code, severity, params, message, line and column", async () => {
    const path = fixture("json2.yml", WITH_ERROR);
    const parsed = JSON.parse((await run(["validate", path, "--format", "json"])).stdout) as Record<
      string,
      unknown
    >[];
    const entry = parsed.find((candidate) => candidate.code === "UNKNOWN_NEED");
    expect(entry).toBeDefined();
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      "code",
      "column",
      "file",
      "line",
      "message",
      "params",
      "severity",
    ]);
    expect(entry?.file).toBe(path);
    expect(entry?.severity).toBe("error");
    // Both: the `params` are the contract a script reads, the message is what a human reads.
    expect(entry?.params).toEqual({ job: "unit", need: "absent" });
    expect(entry?.message).toBe('job "unit" needs "absent", which does not exist');
    expect(typeof entry?.line).toBe("number");
    expect(typeof entry?.column).toBe("number");
  });

  test("a healthy file returns an empty array", async () => {
    const path = fixture("json3.yml", VALID);
    expect(JSON.parse((await run(["validate", path, "--format", "json"])).stdout)).toEqual([]);
  });

  test("the exit code is the same as in text", async () => {
    const path = fixture("json4.yml", WITH_ERROR);
    expect((await run(["validate", path, "--format", "json"])).exitCode).toBe(
      (await run(["validate", path])).exitCode,
    );
  });

  test("nothing is written to stderr when the analysis succeeds", async () => {
    const path = fixture("json5.yml", WITH_ERROR);
    expect((await run(["validate", path, "--format", "json"])).stderr).toBe("");
  });
});

describe("default file", () => {
  test("looks for .gitlab-ci.yml in the current directory", async () => {
    const result = await run(["validate"], { cwd: join(workspace, "vide-sans-ci") });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(".gitlab-ci.yml");
  });

  test("analyses .gitlab-ci.yml when present", async () => {
    fixture(".gitlab-ci.yml", VALID);
    expect((await run(["validate"], { cwd: workspace })).exitCode).toBe(0);
  });
});

describe("help", () => {
  test("validate appears in the general help", async () => {
    expect((await run(["--help"])).stdout).toContain("validate");
  });

  test("validate is no longer announced as not implemented", async () => {
    expect((await run(["validate", fixture("aide.yml", VALID)])).stderr).not.toContain(
      "not implemented yet",
    );
  });
});

describe("local includes", () => {
  /** A full tree in its own temporary directory: without `.git`, the chosen root is the file's
   *  directory, which is exactly the usual case of a `.gitlab-ci.yml` at the root. */
  function tree(): { root: string; main: string; included: string } {
    const root = mkdtempSync(join(tmpdir(), "keelson-includes-"));
    mkdirSync(join(root, "ci"), { recursive: true });
    writeFileSync(
      join(root, ".gitlab-ci.yml"),
      ["include: /ci/jobs.yml", "", "stages:", "  - build", "  - test", ""].join("\n"),
    );
    writeFileSync(
      join(root, "ci", "jobs.yml"),
      [
        "muet:",
        "  stage: build",
        "",
        "casse:",
        "  stage: inconnu",
        "  script:",
        "    - x",
        "",
      ].join("\n"),
    );
    return {
      root,
      main: join(root, ".gitlab-ci.yml"),
      included: join(root, "ci", "jobs.yml"),
    };
  }

  test("the jobs of an included file are validated", async () => {
    const { main } = tree();
    const output = (await run(["validate", main])).stdout;
    expect(output).toContain("JOB_WITHOUT_SCRIPT");
    expect(output).toContain("UNKNOWN_STAGE");
  });

  /** The point of the milestone for the CLI: a diagnostic from an included file names **that** file,
   *  not the one passed as an argument. Otherwise the user would open `.gitlab-ci.yml` at a line
   *  that contains nothing the message describes. */
  test("each diagnostic names the file it lives in", async () => {
    const { main, included } = tree();
    const parsed = JSON.parse((await run(["validate", main, "--format", "json"])).stdout) as {
      code: string;
      file: string;
      line: number;
    }[];

    const muet = parsed.find((entry) => entry.code === "JOB_WITHOUT_SCRIPT");
    expect(muet?.file).toBe(included);
    expect(muet?.line).toBe(1);
  });

  test("the line is counted in the included file's text, not the main file's", async () => {
    const { main } = tree();
    const parsed = JSON.parse((await run(["validate", main, "--format", "json"])).stdout) as {
      code: string;
      line: number;
    }[];
    // `casse:` is on line 4 of `ci/jobs.yml`. The main file has only six lines, so a conversion
    // done with its text would give a plausible number: that is why the assertion checks the
    // exact value and not "some line exists".
    expect(parsed.find((entry) => entry.code === "UNKNOWN_STAGE")?.line).toBe(4);
  });

  test("a missing include is an error, and the exit code says so", async () => {
    const root = mkdtempSync(join(tmpdir(), "keelson-absent-"));
    writeFileSync(join(root, ".gitlab-ci.yml"), "include: /ci/absent.yml\n");
    const result = await run(["validate", join(root, ".gitlab-ci.yml")]);
    expect(result.stdout).toContain("INCLUDE_NOT_FOUND");
    expect(result.exitCode).toBe(1);
  });
});
