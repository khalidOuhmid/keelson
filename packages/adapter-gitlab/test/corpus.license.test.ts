import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CORPUS_ROOT, corpusFiles } from "./support/corpus.ts";

const licenses = readFileSync(join(CORPUS_ROOT, "LICENSES.md"), "utf8");

describe("corpus licence compliance", () => {
  test("the source repository's copyright notice is reproduced", () => {
    expect(licenses).toContain("Copyright (c) 2011-present GitLab Inc.");
  });

  test("the MIT permission notice is reproduced in full", () => {
    expect(licenses).toContain("Permission is hereby granted, free of charge");
    expect(licenses).toContain(
      "The above copyright notice and this permission notice shall be included in all",
    );
  });

  test("the warranty disclaimer is reproduced", () => {
    expect(licenses).toContain('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND');
  });

  test("the source commit is pinned", () => {
    expect(licenses).toContain("12bfbf8ea1eaa681436f08f4ca059bb1cd7074ba");
  });

  test("every file of the official corpus is listed with its SHA-256", () => {
    const checksums = readFileSync(join(CORPUS_ROOT, "CHECKSUMS.txt"), "utf8");
    for (const file of corpusFiles().filter((entry) => entry.group === "gitlab-templates")) {
      expect(licenses).toContain(file.name);
      expect(checksums).toContain(file.name);
    }
  });

  test("no file comes from ee/, jh/ or doc/", () => {
    for (const forbidden of ["lib/gitlab/ci/templates/../ee", "ee/lib", "jh/lib", "doc/"]) {
      expect(licenses.includes(`| \`${forbidden}`)).toBe(false);
    }
  });
});
