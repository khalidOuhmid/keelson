import { describe, expect, test } from "bun:test";
import { renderMessage } from "@keelson/core/messages";
import { NEED_LATER_STAGE, NEEDS_CYCLE, UNKNOWN_NEED, UNKNOWN_STAGE } from "../src/diagnostics.ts";
import { validate } from "../src/validate.ts";
import { job, need, pipeline, stages } from "./support/pipeline.ts";

function codes(diagnostics: readonly { code: string }[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

describe("pipeline valide", () => {
  test("aucun diagnostic sur un pipeline sain", () => {
    const result = validate(
      pipeline({
        jobs: [job("compile", "build"), job("unit", "test", ["compile"])],
      }),
    );
    expect(result).toEqual([]);
  });

  test("aucun diagnostic sans needs du tout", () => {
    expect(validate(pipeline({ jobs: [job("a", "build"), job("b", "test")] }))).toEqual([]);
  });

  test("un need vers un job du même stage est accepté", () => {
    expect(validate(pipeline({ jobs: [job("a", "test"), job("b", "test", ["a"])] }))).toEqual([]);
  });

  test("une liste de needs vide est acceptée", () => {
    expect(validate(pipeline({ jobs: [job("a", "build", [])] }))).toEqual([]);
  });
});

describe("UNKNOWN_NEED", () => {
  test("signale un need vers un job inexistant", () => {
    const result = validate(pipeline({ jobs: [job("unit", "test", ["absent"])] }));
    expect(codes(result)).toEqual([UNKNOWN_NEED]);
    expect(result[0]?.severity).toBe("error");
    expect(result[0]?.params).toEqual({ job: "unit", need: "absent" });
  });

  test("signale chaque need inexistant séparément", () => {
    const result = validate(pipeline({ jobs: [job("unit", "test", ["x", "y"])] }));
    expect(codes(result)).toEqual([UNKNOWN_NEED, UNKNOWN_NEED]);
  });

  test("un need vers un template est inconnu", () => {
    const result = validate(
      pipeline({
        jobs: [job("unit", "test", [".base"])],
        templates: [{ id: ".base", range: { start: 0, end: 1 } }],
      }),
    );
    expect(codes(result)).toEqual([UNKNOWN_NEED]);
  });

  test("porte la plage du job fautif", () => {
    const faulty = { ...job("unit", "test", ["absent"]), range: { start: 12, end: 42 } };
    expect(validate(pipeline({ jobs: [faulty] }))[0]?.range).toEqual({ start: 12, end: 42 });
  });
});

describe("NEEDS_CYCLE", () => {
  test("signale un cycle de deux jobs avec le chemin", () => {
    const result = validate(pipeline({ jobs: [job("a", "test", ["b"]), job("b", "test", ["a"])] }));
    expect(codes(result)).toEqual([NEEDS_CYCLE]);
    expect(result[0]?.severity).toBe("error");
    expect(result[0]?.params).toEqual({ cycle: ["a", "b", "a"] });
  });

  test("signale un auto-need comme cycle", () => {
    const result = validate(pipeline({ jobs: [job("a", "test", ["a"])] }));
    expect(codes(result)).toEqual([NEEDS_CYCLE]);
    expect(result[0]?.params).toEqual({ cycle: ["a", "a"] });
  });

  test("signale un cycle de trois jobs", () => {
    const result = validate(
      pipeline({
        jobs: [job("a", "test", ["c"]), job("b", "test", ["a"]), job("c", "test", ["b"])],
      }),
    );
    expect(codes(result)).toEqual([NEEDS_CYCLE]);
    expect(result[0]?.params).toEqual({ cycle: ["a", "c", "b", "a"] });
  });

  test("ne signale qu'une fois un cycle atteignable depuis plusieurs entrées", () => {
    const result = validate(
      pipeline({
        jobs: [
          job("entree1", "test", ["a"]),
          job("entree2", "test", ["b"]),
          job("a", "test", ["b"]),
          job("b", "test", ["a"]),
        ],
      }),
    );
    expect(codes(result)).toEqual([NEEDS_CYCLE]);
  });

  test("signale deux cycles disjoints séparément", () => {
    const result = validate(
      pipeline({
        jobs: [
          job("a", "test", ["b"]),
          job("b", "test", ["a"]),
          job("c", "test", ["d"]),
          job("d", "test", ["c"]),
        ],
      }),
    );
    expect(codes(result)).toEqual([NEEDS_CYCLE, NEEDS_CYCLE]);
  });

  test("un graphe en losange sans cycle ne déclenche rien", () => {
    const result = validate(
      pipeline({
        jobs: [
          job("a", "build"),
          job("b", "test", ["a"]),
          job("c", "test", ["a"]),
          job("d", "deploy", ["b", "c"]),
        ],
      }),
    );
    expect(result).toEqual([]);
  });
});

describe("UNKNOWN_STAGE", () => {
  test("signale un job dans un stage non déclaré", () => {
    const result = validate(pipeline({ jobs: [job("unit", "verify")] }));
    expect(codes(result)).toEqual([UNKNOWN_STAGE]);
    expect(result[0]?.severity).toBe("error");
    expect(result[0]?.params).toEqual({ job: "unit", stage: "verify" });
  });

  test("accepte les stages implicites", () => {
    const implicit = stages(".pre", "build", "test", "deploy", ".post").map((stage) => ({
      ...stage,
      implicit: true,
    }));
    expect(validate(pipeline({ stages: implicit, jobs: [job("a", ".pre")] }))).toEqual([]);
  });
});

describe("NEED_LATER_STAGE", () => {
  test("signale un need vers un job d'un stage ultérieur", () => {
    const result = validate(
      pipeline({ jobs: [job("compile", "build", ["publish"]), job("publish", "deploy")] }),
    );
    expect(codes(result)).toEqual([NEED_LATER_STAGE]);
    expect(result[0]?.severity).toBe("warning");
    expect(result[0]?.params).toEqual({
      job: "compile",
      stage: "build",
      need: "publish",
      needStage: "deploy",
    });
  });

  test("un need vers un stage antérieur ne déclenche rien", () => {
    expect(
      validate(pipeline({ jobs: [job("compile", "build"), job("unit", "test", ["compile"])] })),
    ).toEqual([]);
  });

  test("ne signale pas de stage ultérieur quand le stage est lui-même inconnu", () => {
    const result = validate(pipeline({ jobs: [job("a", "inconnu", ["b"]), job("b", "deploy")] }));
    expect(codes(result)).toEqual([UNKNOWN_STAGE]);
  });
});

describe("déterminisme et combinaisons", () => {
  test("deux appels sur le même pipeline donnent le même résultat", () => {
    const input = pipeline({
      jobs: [job("a", "test", ["absent", "b"]), job("b", "build", ["a"])],
    });
    expect(validate(input)).toEqual(validate(input));
  });

  test("les diagnostics suivent l'ordre des jobs", () => {
    const result = validate(
      pipeline({ jobs: [job("premier", "inconnu1"), job("second", "inconnu2")] }),
    );
    expect(result.map((diagnostic) => renderMessage(diagnostic).includes("premier"))).toEqual([
      true,
      false,
    ]);
  });

  test("les needs sous forme objet sont traités comme les chaînes", () => {
    const result = validate(
      pipeline({ jobs: [job("unit", "test", [need("absent", { optional: true })])] }),
    );
    expect(codes(result)).toEqual([UNKNOWN_NEED]);
  });
});
