import { describe, expect, test } from "bun:test";
import { emptyPipeline, type Job, type Pipeline } from "@keelson/core";
import { LAYOUT_FILE, parseLayout, writePositions } from "../src/index.ts";

const PIPELINE = emptyPipeline(".gitlab-ci.yml");

function pipeline(ids: string[]): Pipeline {
  return { ...emptyPipeline(".gitlab-ci.yml"), jobs: ids.map((id) => ({ id }) as Job) };
}

const parsed = (value: unknown, ids = ["unit"]) =>
  parseLayout(JSON.stringify(value), pipeline(ids));

describe("layout.json", () => {
  test("un fichier absent est le cas normal : rien à dire", () => {
    expect(parseLayout(null, pipeline([]))).toEqual({
      overrides: {},
      positions: {},
      diagnostics: [],
    });
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
});

describe("positions", () => {
  test("lues depuis layout.json", () => {
    const { positions } = parseLayout(
      '{"version":1,"positions":{"service:nexus":{"x":10,"y":-4.5}}}',
      PIPELINE,
    );
    expect(positions).toEqual({ "service:nexus": { x: 10, y: -4.5 } });
  });

  test("absentes, ou le fichier invalide, rendent une table vide", () => {
    expect(parseLayout(null, PIPELINE).positions).toEqual({});
    expect(parseLayout("{", PIPELINE).positions).toEqual({});
  });

  test("écrire garde les clés voisines et trie les nœuds", () => {
    const written = writePositions('{"version":1,"layers":{"a":["sast"]},"autre":true}', {
      b: { x: 1, y: 2 },
      a: { x: 0, y: 0 },
    });
    expect(written).toBe(
      `${JSON.stringify(
        {
          version: 1,
          layers: { a: ["sast"] },
          autre: true,
          positions: { a: { x: 0, y: 0 }, b: { x: 1, y: 2 } },
        },
        null,
        2,
      )}\n`,
    );
  });

  test("écrire fusionne avec les positions déjà là", () => {
    const written = writePositions('{"version":1,"positions":{"a":{"x":1,"y":1}}}', {
      b: { x: 2, y: 2 },
    });
    expect(JSON.parse(written ?? "").positions).toEqual({
      a: { x: 1, y: 1 },
      b: { x: 2, y: 2 },
    });
  });

  test("écrire crée le fichier absent", () => {
    expect(JSON.parse(writePositions(null, {}) ?? "")).toEqual({ version: 1, positions: {} });
  });

  test("un fichier illisible n'est pas écrasé", () => {
    expect(writePositions("{", {})).toBeNull();
    expect(writePositions("[]", {})).toBeNull();
    expect(writePositions('{"version":2}', {})).toBeNull();
  });
});
