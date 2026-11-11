import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPartial } from "@keelson/core";
import { parse } from "../src/parse.ts";
import { createFileReader } from "../src/reader.ts";

describe("the multi-file dev fixture", () => {
  test("resolves with its includes, and stays partial", () => {
    const root = join(import.meta.dir, "..", "..", "ui", "dev-fixture-includes");
    const parsed = parse(readFileSync(join(root, ".gitlab-ci.yml"), "utf8"), {
      read: createFileReader(root),
    });
    expect(parsed.pipeline.jobs.map((job) => [job.id, job.file])).toEqual([
      ["sast", "ci/security.yml"],
      ["compile", ".gitlab-ci.yml"],
    ]);
    expect(isPartial(parsed.pipeline)).toBe(true);
  });
});
