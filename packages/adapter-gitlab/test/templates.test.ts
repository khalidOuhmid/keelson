import { describe, expect, test } from "bun:test";
import type { IncludeReader } from "../src/includes.ts";
import { parse } from "../src/parse.ts";
import { readEdgeCase } from "./support/corpus.ts";

function template(text: string, id: string, read?: IncludeReader) {
  const found = parse(text, read === undefined ? {} : { read }).pipeline.templates.find(
    (candidate) => candidate.id === id,
  );
  if (found === undefined) {
    throw new Error(`template "${id}" missing from the pipeline`);
  }
  return found;
}

function job(text: string, id: string) {
  const found = parse(text).pipeline.jobs.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`job "${id}" missing from the pipeline`);
  }
  return found;
}

describe("a template's own extends", () => {
  const CHAIN = [
    ".base:",
    "  image: alpine",
    ".build:",
    "  extends: .base",
    "  stage: build",
    ".both:",
    "  extends: [.base, .build, .base]",
    "compile:",
    "  extends: .build",
    "  script: make",
    "",
  ].join("\n");

  test("a template extending another names it", () => {
    expect(template(CHAIN, ".build").extends).toEqual([".base"]);
  });

  test("a template extending nothing has an empty list", () => {
    expect(template(CHAIN, ".base").extends).toEqual([]);
  });

  test("a list of parents is kept in order, without duplicates", () => {
    expect(template(CHAIN, ".both").extends).toEqual([".base", ".build"]);
  });

  test("an included template keeps the extends written in its file", () => {
    const main = "include: /ci/base.yml\ncompile:\n  extends: .build\n  script: make\n";
    const read: IncludeReader = {
      read: (path) =>
        path === "ci/base.yml" ? ".base:\n  image: alpine\n.build:\n  extends: .base\n" : null,
      candidates: () => ["ci/base.yml"],
    };
    expect(template(main, ".build", read).extends).toEqual([".base"]);
  });
});

describe("templates merged through an anchor", () => {
  const ANCHORS = readEdgeCase("anchors-merge");

  test("a job merging one template names it", () => {
    expect(job(ANCHORS, "compile").merges).toEqual([".defaults"]);
  });

  test("a job merging a list of templates names each, in order", () => {
    expect(job(ANCHORS, "unit").merges).toEqual([".defaults", ".extra"]);
  });

  test("a template merging another names it", () => {
    const text = `${ANCHORS}.more:\n  <<: *extra\n  retry: 1\n`;
    expect(template(text, ".more").merges).toEqual([".extra"]);
  });

  test("a job or template merging nothing carries no merges", () => {
    const plain = "compile:\n  script: make\n.t:\n  image: x\n";
    expect(job(plain, "compile")).not.toHaveProperty("merges");
    expect(template(plain, ".t")).not.toHaveProperty("merges");
  });

  test("an anchor name written twice names the template declared last before the alias", () => {
    const text = [
      "stages: [build, deploy]",
      ".a: &x",
      "  stage: build",
      "first:",
      "  <<: *x",
      "  script: a",
      ".b: &x",
      "  stage: deploy",
      "second:",
      "  <<: *x",
      "  script: b",
      "",
    ].join("\n");
    expect(job(text, "first").merges).toEqual([".a"]);
    expect(job(text, "first").stage.value).toBe("build");
    expect(job(text, "second").merges).toEqual([".b"]);
    expect(job(text, "second").stage.value).toBe("deploy");
  });

  test("an anchor that is not a template's own map names no template", () => {
    const text = [
      "compile: &compile",
      "  script: make",
      "  variables: &vars",
      "    A: '1'",
      "again:",
      "  <<: *compile",
      "  variables:",
      "    <<: *vars",
      "",
    ].join("\n");
    expect(job(text, "again")).not.toHaveProperty("merges");
  });
});
