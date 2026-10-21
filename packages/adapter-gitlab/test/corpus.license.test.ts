import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CORPUS_ROOT, corpusFiles } from "./support/corpus.ts";

const licenses = readFileSync(join(CORPUS_ROOT, "LICENSES.md"), "utf8");

describe("conformité de la licence du corpus", () => {
  test("la notice de copyright du dépôt source est reproduite", () => {
    expect(licenses).toContain("Copyright (c) 2011-present GitLab Inc.");
  });

  test("la notice de permission MIT est reproduite intégralement", () => {
    expect(licenses).toContain("Permission is hereby granted, free of charge");
    expect(licenses).toContain(
      "The above copyright notice and this permission notice shall be included in all",
    );
  });

  test("la clause de non-garantie est reproduite", () => {
    expect(licenses).toContain('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND');
  });

  test("le commit source est épinglé", () => {
    expect(licenses).toContain("12bfbf8ea1eaa681436f08f4ca059bb1cd7074ba");
  });

  test("chaque fichier du corpus officiel est listé avec son SHA-256", () => {
    const checksums = readFileSync(join(CORPUS_ROOT, "CHECKSUMS.txt"), "utf8");
    for (const file of corpusFiles().filter((entry) => entry.group === "gitlab-templates")) {
      expect(licenses).toContain(file.name);
      expect(checksums).toContain(file.name);
    }
  });

  test("aucun fichier ne vient de ee/, jh/ ou doc/", () => {
    for (const forbidden of ["lib/gitlab/ci/templates/../ee", "ee/lib", "jh/lib", "doc/"]) {
      expect(licenses.includes(`| \`${forbidden}`)).toBe(false);
    }
  });
});
