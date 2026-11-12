import { describe, expect, test } from "bun:test";
import { renderMessage } from "@keelson/core/messages";
import fc from "fast-check";
import { GITLAB_CI_FILE, parse } from "../../src/parse.ts";
import { assertOptions, corpusTexts } from "./support/arbitraries.ts";

const texts = corpusTexts();

const KEYS = [
  "stages",
  "include",
  "default",
  "variables",
  "workflow",
  "inherit",
  ".t",
  ".u",
  "a",
  "b",
  "job",
  "extends",
  "needs",
  "script",
  "before_script",
  "image",
  "services",
  "stage",
  "environment",
  "name",
  "url",
  "action",
  "rules",
  "when",
  "trigger",
  "parallel",
  "matrix",
  "local",
  "remote",
  "project",
  "file",
  "template",
  "component",
  "optional",
  "artifacts",
  "<<",
  "? complex",
  "",
  "1",
] as const;

const SCALARS = [
  "x",
  "a",
  "b",
  ".t",
  ".u",
  "build",
  "test",
  ".pre",
  ".post",
  "null",
  "~",
  "yes",
  "''",
  '"d"',
  "1",
  "-1",
  "1e400",
  "$CI_X",
  "*.yml",
  "/ci/a.yml",
  "ci/a.yml",
  "ci/b.yml",
  "x.yml",
  "ci/**/*.yml",
  "https://example.org/ci.yml",
  "!reference [.t, script]",
  "!reference [.u, .t]",
  "!reference [a]",
  "!reference []",
  "!reference x",
  "!!binary aGk=",
  "!!set {a, b}",
  "!!omap [a: 1]",
  "!custom x",
] as const;

const ANCHORS = ["e", "s", "t"] as const;

/** Flow-style YAML built from GitLab's vocabulary, with anchors, aliases, merges and tags placed
 *  anywhere: the shapes a hand-written text can take, cycles included. */
const flow = fc.letrec<{ node: string }>((tie) => ({
  node: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.constantFrom(...SCALARS),
    fc.constantFrom(...ANCHORS).map((name) => `*${name}`),
    fc.tuple(fc.constantFrom(...ANCHORS), tie("node")).map(([name, value]) => `&${name} ${value}`),
    fc
      .array(fc.tuple(fc.constantFrom(...KEYS), tie("node")), { maxLength: 5 })
      .map((entries) => `{${entries.map(([key, value]) => `${key}: ${value}`).join(", ")}}`),
    fc.array(tie("node"), { maxLength: 4 }).map((items) => `[${items.join(", ")}]`),
  ),
})).node;

/** A block-style document whose top-level keys hold flow values. */
const block = fc
  .array(fc.tuple(fc.constantFrom(...KEYS), flow), { minLength: 1, maxLength: 8 })
  .map((entries) => entries.map(([key, value]) => `${key}: ${value}\n`).join(""));

/** A corpus text with lines dropped, duplicated, re-indented or spliced with a fragment. */
const mutated = fc
  .tuple(
    fc.constantFrom(...texts),
    fc.array(
      fc.tuple(
        fc.nat(),
        fc.constantFrom("drop", "duplicate", "indent", "dedent", "insert"),
        flow,
        fc.constantFrom(...KEYS),
      ),
      { minLength: 1, maxLength: 6 },
    ),
  )
  .map(([text, edits]) => {
    const lines = text.split("\n");
    for (const [at, edit, value, key] of edits) {
      const index = at % Math.max(lines.length, 1);
      const line = lines[index] ?? "";
      if (edit === "drop") {
        lines.splice(index, 1);
      } else if (edit === "duplicate") {
        lines.splice(index, 0, line);
      } else if (edit === "indent") {
        lines[index] = `  ${line}`;
      } else if (edit === "dedent") {
        lines[index] = line.replace(/^ {1,2}/, "");
      } else {
        lines.splice(index, 0, `${line.match(/^\s*/)?.[0] ?? ""}${key}: ${value}`);
      }
    }
    return lines.join("\n");
  });

const raw = fc.string({
  unit: fc.constantFrom(..."ab:-[]{}&*!<>|'\"#?,.%@` \n\t\\".split("")),
  maxLength: 200,
});

const yamlText = fc.oneof(block, mutated, raw);

/** The included files come from the same arbitraries, under the paths the vocabulary names. */
const files = fc.dictionary(
  fc.constantFrom("ci/a.yml", "ci/b.yml", ".gitlab-ci.yml", "x.yml"),
  yamlText,
  { maxKeys: 3 },
);

describe("property: parse never throws, and its diagnostics render", () => {
  test("on arbitrary YAML text, alone", () => {
    fc.assert(
      fc.property(yamlText, (text) => {
        const { diagnostics } = parse(text);
        expect(() => diagnostics.map((entry) => renderMessage(entry))).not.toThrow();
      }),
      assertOptions(),
    );
  });

  test("on arbitrary YAML text, with included files of the same kind", () => {
    fc.assert(
      fc.property(yamlText, files, (text, included) => {
        const read = {
          read: (path: string) => (Object.hasOwn(included, path) ? (included[path] ?? null) : null),
          candidates: () => Object.keys(included),
        };
        expect(() => parse(text, { file: GITLAB_CI_FILE, read })).not.toThrow();
      }),
      assertOptions(),
    );
  });

  test.each([
    ["a merge cycle", "job:\n  script: x\n  environment: &e {name: n, <<: *e}\n"],
    ["a sequence cycle", "job:\n  script: &s [a, *s]\n"],
    [
      "a !reference crossing two templates",
      ".t:\n  script: !reference [.u, script]\n.u:\n  script: !reference [.t, script]\njob:\n  script: !reference [.t, script]\n",
    ],
    ["a map cycle", "job: &j\n  script: x\n  variables: *j\n"],
    [
      "an extends cycle through an anchor",
      ".t: &t\n  extends: .t\n  <<: *t\njob:\n  extends: .t\n",
    ],
  ])("on %s", (_label, text) => {
    expect(() => parse(text)).not.toThrow();
  });
});
