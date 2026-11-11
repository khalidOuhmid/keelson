import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileReader, readInsideRoot, readRegularFile } from "../src/index.ts";

let root = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "keelson-files-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readRegularFile", () => {
  test("reads a regular file", () => {
    const path = join(root, "ci.yml");
    writeFileSync(path, "a:\n  script: [x]\n");
    expect(readRegularFile(path)).toEqual({ ok: true, text: "a:\n  script: [x]\n" });
  });

  test("a directory is not a file", () => {
    const path = join(root, "dir");
    mkdirSync(path);
    expect(readRegularFile(path)).toEqual({ ok: false, reason: "notFile" });
  });

  test("a missing path is reported as missing", () => {
    expect(readRegularFile(join(root, "absent.yml"))).toEqual({ ok: false, reason: "missing" });
  });

  test.skipIf(process.platform === "win32")(
    "a FIFO is refused without blocking on it",
    () => {
      const path = join(root, "fifo");
      execFileSync("mkfifo", [path]);
      expect(readRegularFile(path)).toEqual({ ok: false, reason: "notFile" });
    },
    2000,
  );
});

describe("the include reader", () => {
  test.skipIf(process.platform === "win32")(
    "a FIFO inside the root is refused without blocking on it",
    () => {
      const repo = mkdtempSync(join(tmpdir(), "keelson-reader-fifo-"));
      execFileSync("mkfifo", [join(repo, "ci.yml")]);
      expect(createFileReader(repo).read("ci.yml")).toBeNull();
      expect(readInsideRoot(repo, "ci.yml")).toBeNull();
      rmSync(repo, { recursive: true, force: true });
    },
    2000,
  );
});
