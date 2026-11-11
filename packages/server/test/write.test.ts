import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAtomic } from "../src/write.ts";

let workspace = "";

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "keelson-write-"));
});

afterEach(() => {
  // left in place on purpose: temporary directories are cleaned up by the OS
});

describe("writeAtomic", () => {
  test("writes the requested content", async () => {
    const path = join(workspace, "a.yml");
    writeFileSync(path, "before\n");
    await writeAtomic(path, "after\n");
    expect(readFileSync(path, "utf8")).toBe("after\n");
  });

  test("creates the file if it does not exist", async () => {
    const path = join(workspace, "new.yml");
    await writeAtomic(path, "content\n");
    expect(readFileSync(path, "utf8")).toBe("content\n");
  });

  test("leaves no temporary file behind", async () => {
    const path = join(workspace, "a.yml");
    writeFileSync(path, "before\n");
    await writeAtomic(path, "after\n");
    expect(readdirSync(workspace)).toEqual(["a.yml"]);
  });

  test("keeps the original file's mode", async () => {
    const path = join(workspace, "a.yml");
    writeFileSync(path, "before\n");
    chmodSync(path, 0o640);
    await writeAtomic(path, "after\n");
    expect(statSync(path).mode & 0o777).toBe(0o640);
  });

  test("keeps an executable mode", async () => {
    const path = join(workspace, "a.yml");
    writeFileSync(path, "before\n");
    chmodSync(path, 0o755);
    await writeAtomic(path, "after\n");
    expect(statSync(path).mode & 0o777).toBe(0o755);
  });

  test("writes UTF-8 bytes without a BOM or line-ending rewrites", async () => {
    const path = join(workspace, "crlf.yml");
    await writeAtomic(path, "a:\r\n  b: é\r\n");
    expect(readFileSync(path).toString("utf8")).toBe("a:\r\n  b: é\r\n");
  });

  test("leaves the original file intact if the directory is not writable", async () => {
    const readOnly = mkdtempSync(join(tmpdir(), "keelson-write-ro-"));
    const path = join(readOnly, "a.yml");
    writeFileSync(path, "intact\n");
    chmodSync(readOnly, 0o500);

    await expect(writeAtomic(path, "new\n")).rejects.toThrow();

    chmodSync(readOnly, 0o700);
    expect(readFileSync(path, "utf8")).toBe("intact\n");
    expect(readdirSync(readOnly)).toEqual(["a.yml"]);
  });

  test("the temporary file is created in the same directory as the target", async () => {
    const path = join(workspace, "a.yml");
    writeFileSync(path, "before\n");
    const seen: string[][] = [];
    const original = readdirSync(workspace);
    await writeAtomic(path, "x".repeat(200_000));
    seen.push(original, readdirSync(workspace));
    expect(seen[1]).toEqual(["a.yml"]);
    expect(readFileSync(path, "utf8")).toHaveLength(200_000);
  });

  test("two successive writes end with the last content", async () => {
    const path = join(workspace, "a.yml");
    await writeAtomic(path, "one\n");
    await writeAtomic(path, "two\n");
    expect(readFileSync(path, "utf8")).toBe("two\n");
  });
});
