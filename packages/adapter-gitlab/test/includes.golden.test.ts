import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../src/parse.ts";
import { createFileReader } from "../src/reader.ts";
import { CORPUS_ROOT, type CorpusTree, corpusTrees, readTreeMain } from "./support/corpus.ts";

const trees = corpusTrees();

/** The trees go through the **real** on-disk reader, not through an object literal: it is the
 *  only test that covers `createFileReader`, and it is the one the CLI and the server use. */
function parseTree(tree: CorpusTree) {
  return parse(readTreeMain(tree), { file: tree.main, read: createFileReader(tree.root) });
}

function goldenFor(tree: CorpusTree): unknown {
  const path = join(CORPUS_ROOT, "goldens", "includes", `${tree.name}.expected.ir.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("golden IR of the includes corpus", () => {
  test("the corpus is not empty", () => {
    expect(trees.length).toBeGreaterThan(5);
  });

  for (const tree of trees) {
    test(tree.name, () => {
      expect(JSON.parse(JSON.stringify(parseTree(tree).pipeline))).toEqual(goldenFor(tree));
    });
  }
});

describe("IR invariants on the trees", () => {
  /** The invariant that matters once the IR becomes multi-file: a range is read in the text of
   *  **its** file. Reading it in the main file's text would yield bytes taken from elsewhere —
   *  the defect the milestone L2 review had found in the opaque block viewer, in a worse form,
   *  since the two texts are then unrelated. */
  for (const tree of trees) {
    test(`${tree.name}: every range is true in the text of its file`, () => {
      const pipeline = parseTree(tree).pipeline;
      const texts = new Map(
        [...new Set(pipeline.files)].map((file) => [
          file,
          readFileSync(join(tree.root, file), "utf8"),
        ]),
      );

      const textOf = (file: string): string => {
        const text = texts.get(file);
        if (text === undefined) {
          throw new Error(`${tree.name}: ${file} is not in pipeline.files`);
        }
        return text;
      };

      for (const job of pipeline.jobs) {
        expect(textOf(job.file).slice(job.range.start, job.range.end)).toStartWith(job.id);
        for (const block of job.opaque) {
          expect(textOf(block.file).slice(block.range.start, block.range.end)).toStartWith(
            block.key,
          );
        }
      }

      for (const template of pipeline.templates) {
        expect(textOf(template.file).slice(template.range.start, template.range.end)).toStartWith(
          template.id,
        );
      }

      for (const stage of pipeline.stages) {
        if (stage.range !== null) {
          expect(textOf(stage.file).slice(stage.range.start, stage.range.end)).toBe(stage.name);
        }
      }

      for (const block of pipeline.opaque) {
        expect(textOf(block.file).slice(block.range.start, block.range.end)).toStartWith(block.key);
      }
    });
  }

  test("every diagnostic names a file of the tree", () => {
    for (const tree of trees) {
      const parsed = parseTree(tree);
      for (const diagnostic of parsed.diagnostics) {
        expect({
          tree: tree.name,
          code: diagnostic.code,
          known: parsed.pipeline.files.includes(diagnostic.file),
        }).toEqual({ tree: tree.name, code: diagnostic.code, known: true });
      }
    }
  });

  test("the main file is always last in the merge order", () => {
    for (const tree of trees) {
      const pipeline = parseTree(tree).pipeline;
      expect({ tree: tree.name, last: pipeline.files.at(-1) }).toEqual({
        tree: tree.name,
        last: tree.main,
      });
    }
  });

  test("no element names a file missing from the merge order", () => {
    for (const tree of trees) {
      const pipeline = parseTree(tree).pipeline;
      const known = new Set(pipeline.files);
      const named = [
        ...pipeline.jobs.map((job) => job.file),
        ...pipeline.jobs.flatMap((job) => job.opaque.map((block) => block.file)),
        ...pipeline.templates.map((template) => template.file),
        ...pipeline.stages.map((stage) => stage.file),
        ...pipeline.opaque.map((block) => block.file),
      ];
      expect({ tree: tree.name, unknown: named.filter((file) => !known.has(file)) }).toEqual({
        tree: tree.name,
        unknown: [],
      });
    }
  });
});

describe("createFileReader", () => {
  const simple = join(CORPUS_ROOT, "includes", "simple");

  test("reads a file at the root", () => {
    expect(createFileReader(simple).read("ci/jobs.yml")).toContain("compile:");
  });

  /** The second barrier, after `normaliseIncludePath`. It is redundant by choice: it is the last
   *  line before a `readFileSync` triggered by the file of an arbitrary repository, read by a
   *  server that answers a web page. The path tested here is **already normalised**, so it does
   *  not go through the first check — it is indeed this one that it measures. */
  test("refuses a path that leaves the root, even when already normalised", () => {
    const reader = createFileReader(simple);
    expect(reader.read("../override/ci/jobs.yml")).toBeNull();
    expect(reader.read("/etc/passwd")).toBeNull();
  });

  test("a missing file returns null rather than throwing", () => {
    expect(createFileReader(simple).read("ci/absent.yml")).toBeNull();
  });

  test("candidates returns only YAML files, paths relative to the root", () => {
    const found = createFileReader(join(CORPUS_ROOT, "includes", "wildcard")).candidates();
    expect([...found].sort()).toEqual([
      ".gitlab-ci.yml",
      "configs/a.yml",
      "configs/b.yml",
      "configs/sous/z.yml",
    ]);
  });
});
