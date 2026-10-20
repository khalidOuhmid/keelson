import { describe, expect, test } from "bun:test";
import { BASE, expectOk, expectUnchanged, roundTrip } from "../support/apply.ts";

describe("moveStage", () => {
  test("déplace un stage vers le début", () => {
    const applied = expectOk(BASE, { kind: "moveStage", name: "deploy", toIndex: 0 });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual(["deploy", "build", "test"]);
  });

  test("déplace un stage vers la fin", () => {
    const applied = expectOk(BASE, { kind: "moveStage", name: "build", toIndex: 2 });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual(["test", "deploy", "build"]);
  });

  test("déplacer au même index laisse l'ordre inchangé", () => {
    const applied = expectOk(BASE, { kind: "moveStage", name: "test", toIndex: 1 });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual(["build", "test", "deploy"]);
  });

  test("ne touche pas aux jobs", () => {
    const applied = expectOk(BASE, { kind: "moveStage", name: "deploy", toIndex: 0 });
    expect(applied.text).toContain("compile:\n  stage: build\n  script:\n    - make\n");
    expect(applied.pipeline.jobs.map((job) => job.id)).toEqual(["compile", "unit"]);
  });

  test("matérialise la liste quand les stages sont implicites", () => {
    const applied = expectOk("solo:\n  script:\n    - x\n", {
      kind: "moveStage",
      name: "deploy",
      toIndex: 0,
    });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual([
      "deploy",
      ".pre",
      "build",
      "test",
      ".post",
    ]);
  });

  test("l'inverse restaure les octets d'origine", () => {
    roundTrip(BASE, { kind: "moveStage", name: "deploy", toIndex: 0 });
    roundTrip(BASE, { kind: "moveStage", name: "build", toIndex: 2 });
    roundTrip("solo:\n  script:\n    - x\n", { kind: "moveStage", name: "deploy", toIndex: 0 });
  });

  test("STAGE_NOT_FOUND si le stage n'existe pas", () => {
    expectUnchanged(BASE, { kind: "moveStage", name: "absent", toIndex: 0 }, "STAGE_NOT_FOUND");
  });

  test("RANGE_OUT_OF_BOUNDS si l'index cible dépasse la liste", () => {
    expectUnchanged(BASE, { kind: "moveStage", name: "build", toIndex: 9 }, "RANGE_OUT_OF_BOUNDS");
  });
});

describe("moveStage sans effet", () => {
  test("déplacer un stage à sa propre position ne touche rien", () => {
    const applied = expectOk(BASE, { kind: "moveStage", name: "test", toIndex: 1 });
    expect(applied.text).toBe(BASE);
    expect(applied.touched).toEqual([]);
  });

  test("le cas sans effet reste annulable", () => {
    roundTrip(BASE, { kind: "moveStage", name: "test", toIndex: 1 });
  });

  test("déplacer le premier stage à l'index 0 ne touche rien", () => {
    const applied = expectOk(BASE, { kind: "moveStage", name: "build", toIndex: 0 });
    expect(applied.text).toBe(BASE);
  });

  test("ne lève jamais d'exception sur un fichier commenté", () => {
    const commente = [
      "stages:",
      "  - build # un commentaire",
      "  - test",
      "",
      "boulot:",
      "  stage: build",
      "  script:",
      "    - x",
      "",
    ].join("\n");
    for (let index = 0; index < 2; index += 1) {
      for (const name of ["build", "test"]) {
        expect(() => expectOk(commente, { kind: "moveStage", name, toIndex: index })).not.toThrow();
      }
    }
  });
});
