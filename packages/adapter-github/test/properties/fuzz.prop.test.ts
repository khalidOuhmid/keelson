import { describe, expect, test } from "bun:test";
import { renderMessage } from "@keelson/core/messages";
import fc from "fast-check";
import { parse } from "../../src/index.ts";
import { assertOptions, corpusTexts, FILE } from "./support/arbitraries.ts";

const texts = corpusTexts();

const KEYS = [
  "on",
  "name",
  "jobs",
  "build",
  "test",
  "deploy",
  "runs-on",
  "needs",
  "environment",
  "url",
  "steps",
  "uses",
  "run",
  "with",
  "env",
  "if",
  "strategy",
  "matrix",
  "include",
  "container",
  "image",
  "services",
  "outputs",
  "secrets",
  "inputs",
  "workflow_call",
  "runs",
  "using",
  "<<",
  "? complex",
  "",
  "1",
] as const;

const SCALARS = [
  "x",
  "build",
  "test",
  "deploy",
  "push",
  "ubuntu-latest",
  "composite",
  "null",
  "~",
  "yes",
  "''",
  '"d"',
  "1",
  "1e400",
  `\${{ needs.build.outputs.v }}`,
  `\${{ matrix.os }}`,
  "actions/checkout@v4",
  "./.github/workflows/b.yml",
  "./.github/actions/a",
  "./.github/workflows/ci.yml",
  "octo/repo/.github/workflows/w.yml@main",
  "docker://alpine:3",
  "aquasec/trivy-action@master",
  "!!binary aGk=",
  "!!set {a, b}",
  "!custom x",
] as const;

const ANCHORS = ["e", "s", "t"] as const;

/** Flow-style YAML built from the workflow vocabulary, with anchors, aliases, merges and tags
 *  placed anywhere, cycles included. */
const flow = fc.letrec<{ node: string }>((tie) => ({
  node: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.constantFrom(...SCALARS).map((value) => (value.includes("{{") ? `'${value}'` : value)),
    fc.constantFrom(...ANCHORS).map((name) => `*${name}`),
    fc.tuple(fc.constantFrom(...ANCHORS), tie("node")).map(([name, value]) => `&${name} ${value}`),
    fc
      .array(fc.tuple(fc.constantFrom(...KEYS), tie("node")), { maxLength: 5 })
      .map((entries) => `{${entries.map(([key, value]) => `${key}: ${value}`).join(", ")}}`),
    fc.array(tie("node"), { maxLength: 4 }).map((items) => `[${items.join(", ")}]`),
  ),
})).node;

const block = fc
  .array(fc.tuple(fc.constantFrom(...KEYS), flow), { minLength: 1, maxLength: 8 })
  .map((entries) => entries.map(([key, value]) => `${key}: ${value}\n`).join(""));

/** A corpus workflow with lines dropped, duplicated, re-indented or spliced with a fragment. */
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
  unit: fc.constantFrom(..."ab:-[]{}&*!<>|'\"#?,.%@$` \n\t\\".split("")),
  maxLength: 200,
});

const yamlText = fc.oneof(block, mutated, raw);

/** Called workflows and composite actions come from the same arbitraries. */
const files = fc.dictionary(
  fc.constantFrom(
    ".github/workflows/b.yml",
    ".github/workflows/ci.yml",
    ".github/actions/a/action.yml",
    ".github/actions/a/action.yaml",
  ),
  yamlText,
  { maxKeys: 3 },
);

describe("property: parse never throws, and its diagnostics render", () => {
  test("on arbitrary YAML text, alone", () => {
    fc.assert(
      fc.property(yamlText, (text) => {
        const { diagnostics } = parse(text, { file: FILE });
        expect(() => diagnostics.map((entry) => renderMessage(entry))).not.toThrow();
      }),
      assertOptions(),
    );
  });

  test("on arbitrary YAML text, with called workflows and actions of the same kind", () => {
    fc.assert(
      fc.property(yamlText, files, (text, called) => {
        const read = {
          read: (path: string) => (Object.hasOwn(called, path) ? (called[path] ?? null) : null),
        };
        expect(() => parse(text, { file: FILE, read })).not.toThrow();
      }),
      assertOptions(),
    );
  });

  test.each([
    ["a merge cycle", "on: push\njobs:\n  a: &a\n    runs-on: x\n    <<: *a\n"],
    ["a sequence cycle", "on: push\njobs:\n  a:\n    runs-on: x\n    steps: &s [{run: x}, *s]\n"],
    [
      "a workflow calling itself",
      "on: workflow_call\njobs:\n  a:\n    uses: ./.github/workflows/ci.yml\n",
    ],
  ])("on %s", (_label, text) => {
    expect(() =>
      parse(text, { file: FILE, read: { read: (path) => (path === FILE ? text : null) } }),
    ).not.toThrow();
  });
});
