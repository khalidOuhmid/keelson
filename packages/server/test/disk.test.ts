import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDisk } from "../src/index.ts";

const created: string[] = [];

afterAll(() => {
  for (const directory of created) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function root(): string {
  const directory = mkdtempSync(join(tmpdir(), "keelson-disk-"));
  created.push(directory);
  return directory;
}

describe("readDisk", () => {
  test("a readable UTF-8 file is its text", () => {
    const at = root();
    writeFileSync(join(at, "a.yml"), "é: 1\n");
    expect(readDisk(at, "a.yml")).toEqual({ kind: "text", text: "é: 1\n" });
  });

  test("a missing file, or one under a missing directory, is absent", () => {
    expect(readDisk(root(), "missing/a.yml")).toEqual({ kind: "absent" });
  });

  test("a file under a regular file is absent", () => {
    const at = root();
    writeFileSync(join(at, ".devsecops"), "x");
    expect(readDisk(at, ".devsecops/toolchain.yaml")).toEqual({ kind: "absent" });
  });

  test("a file that is not UTF-8 is unreadable, not rewritten with replacement characters", () => {
    const at = root();
    writeFileSync(join(at, "a.yml"), Buffer.from([0x61, 0x3a, 0x20, 0xff, 0xfe, 0x0a]));
    expect(readDisk(at, "a.yml")).toEqual({ kind: "unreadable" });
  });

  test("a directory is unreadable", () => {
    const at = root();
    mkdirSync(join(at, "a.yml"));
    expect(readDisk(at, "a.yml")).toEqual({ kind: "unreadable" });
  });

  test("a link outside the root is unreadable", () => {
    const outside = root();
    writeFileSync(join(outside, "a.yml"), "a: 1\n");
    const at = root();
    symlinkSync(join(outside, "a.yml"), join(at, "a.yml"));
    expect(readDisk(at, "a.yml")).toEqual({ kind: "unreadable" });
  });
});
