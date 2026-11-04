import { describe, expect, test } from "bun:test";
import { emptyPipeline, type Job, type Pipeline } from "@keelson/core";
import { LAYOUT_FILE, parseLayout } from "../src/index.ts";

function pipeline(ids: string[]): Pipeline {
  return { ...emptyPipeline(".gitlab-ci.yml"), jobs: ids.map((id) => ({ id }) as Job) };
}

const parsed = (value: unknown, ids = ["unit"]) =>
  parseLayout(JSON.stringify(value), pipeline(ids));

describe("layout.json", () => {
  test("un fichier absent est le cas normal : rien à dire", () => {
    expect(parseLayout(null, pipeline([]))).toEqual({ overrides: {}, diagnostics: [] });
  });

  test("une surcharge est lue, et une liste vide reste une surcharge", () => {
    const result = parsed({ version: 1, layers: { unit: ["sast"], lint: [] } }, ["unit", "lint"]);
    expect(result.overrides).toEqual({ unit: ["sast"], lint: [] });
    expect(result.diagnostics).toEqual([]);
  });

  test("les positions du lot L4 ne gênent pas", () => {
    expect(parsed({ version: 1, positions: {} }).diagnostics).toEqual([]);
  });

  test("un JSON illisible est signalé et ignoré, avec le chemin du fichier", () => {
    const result = parseLayout("{", pipeline([]));
    expect(result.overrides).toEqual({});
    expect(result.diagnostics[0]).toMatchObject({
      code: "LAYOUT_INVALID",
      severity: "warning",
      file: LAYOUT_FILE,
      range: null,
    });
  });

  test("une version inconnue est refusée en entier", () => {
    expect(parsed({ version: 2, layers: { unit: ["sast"] } }).overrides).toEqual({});
    expect(parsed({ version: 2 }).diagnostics[0]?.code).toBe("LAYOUT_INVALID");
  });

  test("une couche inconnue est signalée, les autres s'appliquent", () => {
    const result = parsed({ version: 1, layers: { unit: ["sast", "inventee"] } });
    expect(result.overrides).toEqual({ unit: ["sast"] });
    expect(result.diagnostics.map((entry) => entry.params)).toEqual([
      { job: "unit", layer: "inventee" },
    ]);
  });

  test("un job inconnu est signalé et ne produit pas de surcharge", () => {
    const result = parsed({ version: 1, layers: { absent: ["sast"] } });
    expect(result.overrides).toEqual({});
    expect(result.diagnostics[0]?.code).toBe("LAYOUT_UNKNOWN_JOB");
  });

  test("une clé __proto__ ne pollue rien", () => {
    const result = parseLayout('{"version":1,"layers":{"__proto__":["sast"]}}', pipeline([]));
    expect(Object.keys(result.overrides)).toEqual([]);
    expect(({} as Record<string, unknown>).sast).toBeUndefined();
  });
});
