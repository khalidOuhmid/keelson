import { describe, expect, test } from "bun:test";
import { EXTENDS_CYCLE, EXTENDS_TARGET_NOT_FOUND } from "@keelson/core";
import { parse } from "../src/parse.ts";
import { readEdgeCase } from "./support/corpus.ts";

function job(text: string, id: string) {
  const found = parse(text).pipeline.jobs.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`job "${id}" missing from the pipeline`);
  }
  return found;
}

function codes(text: string): string[] {
  return parse(text).diagnostics.map((diagnostic) => diagnostic.code);
}

describe("three-level extends chain", () => {
  const text = readEdgeCase("extends-chain");

  test("the stage comes from the highest-priority template that declares it", () => {
    expect(job(text, "final").stage).toEqual({
      value: "test",
      origin: { kind: "extends", template: ".niveau2" },
    });
  });

  test("the needs come from the deepest template that declares them", () => {
    const needs = job(text, "final").needs;
    expect(needs?.origin).toEqual({ kind: "extends", template: ".niveau1" });
    expect(needs?.value).toEqual([{ job: "prepare", optional: false, artifacts: true }]);
  });

  test("maps are deep-merged across the chain", () => {
    expect(job(text, "final").environment).toEqual({
      value: { name: "niveau2", url: "https://niveau1.example.org" },
      origin: { kind: "extends", template: ".niveau2" },
    });
  });

  test("the locally declared extends list is kept as is", () => {
    expect(job(text, "final").extends).toEqual([".niveau3"]);
  });

  test("templates are collected separately from jobs", () => {
    const parsed = parse(text);
    expect(parsed.pipeline.templates.map((template) => template.id)).toEqual([
      ".niveau1",
      ".niveau2",
      ".niveau3",
    ]);
    expect(parsed.pipeline.jobs.map((candidate) => candidate.id)).toEqual(["prepare", "final"]);
  });

  test("no extends diagnostic on a sound chain", () => {
    expect(codes(text)).not.toContain(EXTENDS_TARGET_NOT_FOUND);
    expect(codes(text)).not.toContain(EXTENDS_CYCLE);
  });
});

describe("extends with several parents", () => {
  const text = readEdgeCase("extends-multi-parent");

  test("the last listed parent wins over the first", () => {
    expect(job(text, "gagnant").stage).toEqual({
      value: "test",
      origin: { kind: "extends", template: ".second" },
    });
  });

  test("keys missing from the last parent come from the first", () => {
    expect(job(text, "gagnant").environment?.value).toEqual({
      name: "second",
      url: "https://premier.example.org",
    });
  });

  test("the extends list keeps the declared order", () => {
    expect(job(text, "gagnant").extends).toEqual([".premier", ".second"]);
  });
});

describe("local values take precedence", () => {
  test("a local value wins over any inherited value", () => {
    const text = [
      ".base:",
      "  stage: build",
      "",
      "stages:",
      "  - build",
      "  - test",
      "",
      "worker:",
      "  extends: .base",
      "  stage: test",
      "  script: echo",
      "",
    ].join("\n");
    expect(job(text, "worker").stage).toEqual({ value: "test", origin: { kind: "local" } });
  });
});

describe("extends cycle", () => {
  const text = readEdgeCase("extends-cycle");

  test("reports EXTENDS_CYCLE", () => {
    expect(codes(text)).toContain(EXTENDS_CYCLE);
  });

  test("the diagnostic is an error and names the path", () => {
    const cycle = parse(text).diagnostics.find((diagnostic) => diagnostic.code === EXTENDS_CYCLE);
    expect(cycle?.severity).toBe("error");
    expect(cycle?.params).toEqual({ trail: [".a", ".b", ".a"] });
  });

  test("parsing succeeds despite the cycle", () => {
    expect(parse(text).pipeline.jobs.map((candidate) => candidate.id)).toEqual(["boucle"]);
  });
});

describe("missing extends target", () => {
  test("reports EXTENDS_TARGET_NOT_FOUND as an error without include", () => {
    const text = readEdgeCase("extends-missing");
    const found = parse(text).diagnostics.find(
      (diagnostic) => diagnostic.code === EXTENDS_TARGET_NOT_FOUND,
    );
    expect(found?.severity).toBe("error");
    expect(found?.params).toEqual({ template: ".absent" });
  });

  test("downgrades to a warning when the file contains includes", () => {
    const text = readEdgeCase("with-include");
    const found = parse(text).diagnostics.find(
      (diagnostic) => diagnostic.code === EXTENDS_TARGET_NOT_FOUND,
    );
    expect(found?.severity).toBe("warning");
  });
});

describe("anchors and << merge", () => {
  const text = readEdgeCase("anchors-merge");

  test("a value coming from an anchor carries the anchor origin", () => {
    expect(job(text, "compile").stage).toEqual({
      value: "build",
      origin: { kind: "anchor", name: "defaults" },
    });
  });

  test("a local value wins over the merged anchor", () => {
    expect(job(text, "unit").stage).toEqual({ value: "test", origin: { kind: "local" } });
  });

  test("the merge of a list of anchors is resolved", () => {
    expect(job(text, "unit").needs?.value).toEqual([
      { job: "compile", optional: false, artifacts: true },
    ]);
  });

  test("hidden anchors are not jobs", () => {
    expect(parse(text).pipeline.jobs.map((candidate) => candidate.id)).toEqual(["compile", "unit"]);
  });
});

describe("!reference", () => {
  const text = readEdgeCase("reference-tag");

  test("resolves a local !reference and carries the reference origin", () => {
    expect(job(text, "unit").needs).toEqual({
      value: [{ job: "compile", optional: false, artifacts: true }],
      origin: { kind: "reference", path: [".needs", "common"] },
    });
  });

  test("the file parses without a YAML error", () => {
    expect(parse(text).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  test("a !reference in an opaque block does not hinder parsing", () => {
    expect(job(text, "compile").opaque.map((block) => block.key)).toContain("script");
  });
});

describe("needs normalisation", () => {
  const text = readEdgeCase("needs-objects");

  test("the three need forms are normalised", () => {
    expect(job(text, "unit").needs?.value).toEqual([
      { job: "compile", optional: false, artifacts: false },
      { job: "paquet", optional: true, artifacts: true },
      { job: "paquet", optional: false, artifacts: true },
    ]);
  });

  test("flow style is normalised like block style", () => {
    expect(job(readEdgeCase("flow-needs"), "c").needs?.value).toEqual([
      { job: "a", optional: false, artifacts: true },
      { job: "b", optional: false, artifacts: true },
    ]);
  });

  test("a job without needs has needs set to null", () => {
    expect(job(text, "compile").needs).toBeNull();
  });
});

describe("environment normalisation", () => {
  const text = readEdgeCase("environment-forms");

  test("a string becomes an object with a single name", () => {
    expect(job(text, "chaine").environment?.value).toEqual({ name: "production" });
  });

  test("a complete object is kept", () => {
    expect(job(text, "objet").environment?.value).toEqual({
      name: "staging",
      url: "https://staging.example.org",
      action: "start",
    });
  });

  test("an action without url is kept", () => {
    expect(job(text, "arret").environment?.value).toEqual({ name: "staging", action: "stop" });
  });

  test("a job without an environment has environment set to null", () => {
    expect(job(readEdgeCase("flow-needs"), "a").environment).toBeNull();
  });
});
