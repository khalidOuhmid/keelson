import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../src/parse.ts";
import { CORPUS_ROOT, type CorpusFile, corpusFiles, readCorpus } from "./support/corpus.ts";

function goldenFor(file: CorpusFile): unknown {
  const path = join(CORPUS_ROOT, "goldens", file.group, `${file.name}.expected.ir.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

const files = corpusFiles();

describe("IR golden du corpus", () => {
  for (const file of files) {
    test(`${file.group}/${file.name}`, () => {
      const pipeline = parse(readCorpus(file)).pipeline;
      expect(JSON.parse(JSON.stringify(pipeline))).toEqual(goldenFor(file));
    });
  }
});

describe("invariants de l'IR sur tout le corpus", () => {
  for (const file of files) {
    test(`${file.group}/${file.name} : les plages sont cohérentes avec le texte`, () => {
      const text = readCorpus(file);
      const pipeline = parse(text).pipeline;

      for (const job of pipeline.jobs) {
        expect(job.range.start).toBeGreaterThanOrEqual(0);
        expect(job.range.end).toBeLessThanOrEqual(text.length);
        expect(job.range.end).toBeGreaterThan(job.range.start);
        expect(text.slice(job.range.start, job.range.end)).toStartWith(job.id);

        for (const block of job.opaque) {
          expect(block.range.start).toBeGreaterThanOrEqual(job.range.start);
          expect(block.range.end).toBeLessThanOrEqual(job.range.end);
        }
      }

      for (const stage of pipeline.stages) {
        if (stage.range !== null) {
          expect(text.slice(stage.range.start, stage.range.end)).toBe(stage.name);
        }
      }

      for (const template of pipeline.templates) {
        expect(text.slice(template.range.start, template.range.end)).toStartWith(template.id);
      }
    });
  }

  test("aucun job ne porte un identifiant de template", () => {
    for (const file of files) {
      for (const job of parse(readCorpus(file)).pipeline.jobs) {
        expect(job.id.startsWith(".")).toBe(false);
      }
    }
  });

  test("les plages des jobs ne se chevauchent pas", () => {
    for (const file of files) {
      const ranges = parse(readCorpus(file))
        .pipeline.jobs.map((job) => job.range)
        .sort((left, right) => left.start - right.start);

      for (const [index, range] of ranges.entries()) {
        const previous = ranges[index - 1];
        if (previous !== undefined) {
          expect(range.start).toBeGreaterThanOrEqual(previous.end);
        }
      }
    }
  });
});
