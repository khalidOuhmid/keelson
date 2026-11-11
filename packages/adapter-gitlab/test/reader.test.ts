import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileReader } from "../src/reader.ts";

let root = "";
let outside = "";

const SECRET = "SECRET-HORS-DEPOT\n";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "keelson-reader-"));
  outside = mkdtempSync(join(tmpdir(), "keelson-dehors-"));
  mkdirSync(join(root, "ci"), { recursive: true });
  writeFileSync(join(root, "ci", "jobs.yml"), "compile:\n  script:\n    - make\n");
  writeFileSync(join(outside, "secret.txt"), SECRET);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("the root boundary", () => {
  test("a file at the root is read", () => {
    expect(createFileReader(root).read("ci/jobs.yml")).toContain("compile:");
  });

  /** The defect found by the independent review of 2026-10-23, and the worst of the milestone:
   *  both boundary checks were **lexical**, hence blind to symbolic links. A repository cloned
   *  from a third party was enough to leak any file readable by the user into the payload sent
   *  to the browser, without the slightest diagnostic. The `.yml` extension was moreover checked
   *  on the link's name, never on its target. */
  test("a symbolic link that leaves the root is refused", () => {
    symlinkSync(join(outside, "secret.txt"), join(root, "ci", "fuite.yml"));

    const read = createFileReader(root).read("ci/fuite.yml");
    expect(read).toBeNull();
    expect(read).not.toBe(SECRET);
  });

  test("a symbolic link to a directory outside the root is refused too", () => {
    symlinkSync(outside, join(root, "ailleurs"));
    expect(createFileReader(root).read("ailleurs/secret.txt")).toBeNull();
  });

  /** A link is still allowed if it stays under the root: a repository may legitimately contain
   *  some, and the negative assertion alone would let through a reader that refuses every link —
   *  which would be another, quieter defect. */
  test("a symbolic link inside the root is read", () => {
    symlinkSync(join(root, "ci", "jobs.yml"), join(root, "ci", "alias.yml"));
    expect(createFileReader(root).read("ci/alias.yml")).toContain("compile:");
  });

  /** The link stays inside the root, but its target is not YAML: `.git/config` or `.env` would
   *  leak to the browser. The extension is checked on the target, not on the link's name. */
  test("an internal link to a non-YAML file is refused", () => {
    writeFileSync(join(root, ".env"), "API_KEY=x\n");
    symlinkSync(join(root, ".env"), join(root, "ci", "env.yml"));
    expect(createFileReader(root).read("ci/env.yml")).toBeNull();
  });

  /** Without `realPrefix`, comparing a real path with the written root would refuse everything. */
  test("a root reached through a link still reads its files", () => {
    const alias = `${root}-alias`;
    symlinkSync(root, alias);
    try {
      expect(createFileReader(alias).read("ci/jobs.yml")).toContain("compile:");
    } finally {
      rmSync(alias);
    }
  });

  test("a link that leaves the root is told apart from a missing file", () => {
    symlinkSync(join(outside, "secret.txt"), join(root, "ci", "leak.yml"));
    const reader = createFileReader(root);
    expect(reader.outsideRoot?.("ci/leak.yml")).toBe(true);
    expect(reader.outsideRoot?.("ci/absent.yml")).toBe(false);
    expect(reader.outsideRoot?.("ci/jobs.yml")).toBe(false);
  });

  test("a dangling link is missing, not outside", () => {
    symlinkSync(join(root, "ci", "nowhere.yml"), join(root, "ci", "dangling.yml"));
    expect(createFileReader(root).outsideRoot?.("ci/dangling.yml")).toBe(false);
  });

  test("a path that lexically leaves the root is refused", () => {
    expect(createFileReader(root).read("../dehors.yml")).toBeNull();
    expect(createFileReader(root).read("/etc/passwd")).toBeNull();
  });

  /** Reading a FIFO blocks forever, and `detectWorkspace` froze the server's startup. */
  test("only a regular file is read", () => {
    spawnSync("mkfifo", [join(root, "ci", "tube.yml")]);
    expect(createFileReader(root).read("ci/tube.yml")).toBeNull();
  });

  test("a missing file returns null rather than throwing", () => {
    expect(createFileReader(root).read("ci/absent.yml")).toBeNull();
  });
});
