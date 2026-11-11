import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashText, type Operation } from "@keelson/core";
import fc from "fast-check";
import { apply } from "../../src/apply.ts";
import { GITLAB_CI_FILE, parse } from "../../src/parse.ts";
import { createFileReader } from "../../src/reader.ts";
import { corpusTrees, readTreeMain } from "../support/corpus.ts";
import { assertOptions, operationArb } from "./support/arbitraries.ts";

const trees = corpusTrees();

type Case = {
  name: string;
  root: string;
  main: string;
  /** The bytes of each included file, read **before** any operation. */
  included: { file: string; text: string }[];
};

const cases: Case[] = trees.map((tree) => {
  const main = readTreeMain(tree);
  const pipeline = parse(main, {
    file: tree.main,
    read: createFileReader(tree.root),
  }).pipeline;

  return {
    name: tree.name,
    root: tree.root,
    main,
    included: [...new Set(pipeline.files)]
      .filter((file) => file !== tree.main)
      .map((file) => ({ file, text: readFileSync(join(tree.root, file), "utf8") })),
  };
});

function parseCase(entry: Case, text: string) {
  return parse(text, { file: GITLAB_CI_FILE, read: createFileReader(entry.root) });
}

function caseArb(): fc.Arbitrary<{ entry: Case; draft: unknown }> {
  return fc.constantFrom(...cases).chain((entry) =>
    operationArb(entry.main, parseCase(entry, entry.main).pipeline).map((draft) => ({
      entry,
      draft,
    })),
  );
}

function run(entry: Case, text: string, draft: unknown) {
  const operation = { v: 1, baseHash: hashText(text), ...(draft as object) } as Operation;
  return apply(parseCase(entry, text).document, operation);
}

describe("properties on multi-file trees", () => {
  test("the tree corpus is indeed the one feeding these properties", () => {
    expect(cases.length).toBe(trees.length);
    expect(cases.some((entry) => entry.included.length > 0)).toBe(true);
  });

  /** The clause this milestone adds to locality, and **what it can measure here**. `apply` is a
   *  pure function: re-reading the files from disk after the call says nothing, because nothing
   *  ever writes them — the independent review of 2026-10-23 proved it by neutralising every
   *  `FROM_INCLUDED_FILE` refusal without turning this file red.
   *
   *  What is measurable on a pure function is that its result claims to have changed nothing
   *  elsewhere: `included` comes back identical for every generated operation. The guarantee on
   *  the bytes on disk is measured where a write takes place, in
   *  `packages/server/test/includes.test.ts`. */
  test("no operation claims to have changed an included file", () => {
    fc.assert(
      fc.property(caseArb(), ({ entry, draft }) => {
        const result = run(entry, entry.main, draft);
        if (!result.ok) {
          return;
        }

        const before = Object.fromEntries(entry.included.map((file) => [file.file, file.text]));
        expect(result.value.included).toEqual(before);
      }),
      assertOptions(),
    );
  });

  test("round-trip: the inverse restores the bytes of the main file", () => {
    fc.assert(
      fc.property(caseArb(), ({ entry, draft }) => {
        const result = run(entry, entry.main, draft);
        if (!result.ok) {
          return;
        }
        const back = apply(result.value.document, result.value.inverse);
        if (!back.ok) {
          throw new Error(`inverse refused: ${back.error.code}`);
        }
        expect(back.value.text).toBe(entry.main);
      }),
      assertOptions(),
    );
  });

  test("determinism: two applications of the same operation return the same text", () => {
    fc.assert(
      fc.property(caseArb(), ({ entry, draft }) => {
        const first = run(entry, entry.main, draft);
        const second = run(entry, entry.main, draft);
        expect(first.ok).toBe(second.ok);
        if (first.ok && second.ok) {
          expect(first.value.text).toBe(second.value.text);
        }
      }),
      assertOptions(),
    );
  });

  test("locality: the prefix before the first touched range is intact", () => {
    fc.assert(
      fc.property(caseArb(), ({ entry, draft }) => {
        const result = run(entry, entry.main, draft);
        if (!result.ok) {
          return;
        }
        const first = result.value.touched[0];
        if (first === undefined) {
          expect(result.value.text).toBe(entry.main);
          return;
        }
        expect(result.value.text.slice(0, first.start)).toBe(entry.main.slice(0, first.start));
      }),
      assertOptions(),
    );
  });

  /** Without this property, an accepted operation could return a pipeline stripped of its included
   *  jobs — which is what happened when `apply` re-read the text without its include reader. */
  test("a pipeline returned after an operation keeps every file of the tree", () => {
    fc.assert(
      fc.property(caseArb(), ({ entry, draft }) => {
        const result = run(entry, entry.main, draft);
        if (!result.ok) {
          return;
        }
        const before = parseCase(entry, entry.main).pipeline.files;
        expect(result.value.pipeline.files).toEqual(before);
      }),
      assertOptions(),
    );
  });
});
