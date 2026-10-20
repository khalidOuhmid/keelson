import { describe, expect, test } from "bun:test";
import { DEFAULT_STAGE, DEFAULT_STAGES } from "../src/defaults.ts";
import { parse } from "../src/parse.ts";
import { readEdgeCase } from "./support/corpus.ts";

function jobNamed(text: string, id: string) {
  const job = parse(text).pipeline.jobs.find((candidate) => candidate.id === id);
  if (job === undefined) {
    throw new Error(`job « ${id} » absent du pipeline`);
  }
  return job;
}

describe("constantes", () => {
  test("les stages par défaut sont ceux de GitLab", () => {
    expect([...DEFAULT_STAGES]).toEqual([".pre", "build", "test", "deploy", ".post"]);
  });

  test("le stage par défaut d'un job est test", () => {
    expect(DEFAULT_STAGE).toBe("test");
  });
});

describe("fichier sans clé stages", () => {
  const text = readEdgeCase("no-stages");

  test("matérialise les cinq stages par défaut", () => {
    expect(parse(text).pipeline.stages.map((stage) => stage.name)).toEqual([
      ".pre",
      "build",
      "test",
      "deploy",
      ".post",
    ]);
  });

  test("marque tous les stages comme implicites et sans plage", () => {
    for (const stage of parse(text).pipeline.stages) {
      expect(stage.implicit).toBe(true);
      expect(stage.range).toBeNull();
    }
  });

  test("un job sans stage est dans test avec l'origine default", () => {
    const job = jobNamed(text, "sans-stage");
    expect(job.stage.value).toBe("test");
    expect(job.stage.origin).toEqual({ kind: "default" });
  });

  test("un job qui déclare son stage garde l'origine locale", () => {
    const job = jobNamed(text, "avant");
    expect(job.stage.value).toBe(".pre");
    expect(job.stage.origin).toEqual({ kind: "local" });
  });

  test("les stages réservés .pre et .post sont utilisables", () => {
    expect(jobNamed(text, "apres").stage.value).toBe(".post");
  });
});

describe("fichier avec clé stages", () => {
  const text = readEdgeCase("flow-needs");

  test("les stages déclarés ne sont pas implicites", () => {
    for (const stage of parse(text).pipeline.stages) {
      expect(stage.implicit).toBe(false);
    }
  });

  test("chaque stage déclaré porte une plage qui pointe sur son nom", () => {
    for (const stage of parse(text).pipeline.stages) {
      expect(stage.range).not.toBeNull();
      if (stage.range !== null) {
        expect(text.slice(stage.range.start, stage.range.end)).toBe(stage.name);
      }
    }
  });

  test("l'ordre des stages est celui du fichier", () => {
    expect(parse(text).pipeline.stages.map((stage) => stage.name)).toEqual(["build", "test"]);
  });

  test("un job sans stage reste dans test par défaut même si stages est déclaré", () => {
    const job = jobNamed("stages:\n  - build\n\nsolo:\n  script: echo\n", "solo");
    expect(job.stage.value).toBe(DEFAULT_STAGE);
    expect(job.stage.origin).toEqual({ kind: "default" });
  });
});
