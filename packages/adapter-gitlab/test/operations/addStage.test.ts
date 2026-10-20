import { describe, expect, test } from "bun:test";
import { BASE, expectOk, expectUnchanged, roundTrip } from "../support/apply.ts";

describe("addStage", () => {
  test("ajoute un stage en fin de liste sans index", () => {
    const applied = expectOk(BASE, { kind: "addStage", name: "verify" });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual([
      "build",
      "test",
      "deploy",
      "verify",
    ]);
  });

  test("ajoute un stage à l'index demandé", () => {
    const applied = expectOk(BASE, { kind: "addStage", name: "verify", index: 1 });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual([
      "build",
      "verify",
      "test",
      "deploy",
    ]);
  });

  test("ajoute un stage en tête avec l'index 0", () => {
    const applied = expectOk(BASE, { kind: "addStage", name: "prepare", index: 0 });
    expect(applied.pipeline.stages.map((stage) => stage.name)[0]).toBe("prepare");
  });

  test("conserve les stages existants octet pour octet", () => {
    const applied = expectOk(BASE, { kind: "addStage", name: "verify" });
    expect(applied.text).toContain("stages:\n  - build\n  - test\n  - deploy\n  - verify\n");
  });

  test("matérialise la clé stages avec la liste par défaut quand elle est absente", () => {
    const sansStages = "solo:\n  script:\n    - x\n";
    const applied = expectOk(sansStages, { kind: "addStage", name: "verify" });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual([
      ".pre",
      "build",
      "test",
      "deploy",
      ".post",
      "verify",
    ]);
    for (const stage of applied.pipeline.stages) {
      expect(stage.implicit).toBe(false);
    }
  });

  test("la matérialisation garde le job intact", () => {
    const sansStages = "solo:\n  script:\n    - x\n";
    const applied = expectOk(sansStages, { kind: "addStage", name: "verify" });
    expect(applied.text).toContain("solo:\n  script:\n    - x\n");
  });

  test("ajoute dans une liste de stages en flow style", () => {
    const flow = BASE.replace(
      "stages:\n  - build\n  - test\n  - deploy\n",
      "stages: [build, test, deploy]\n",
    );
    const applied = expectOk(flow, { kind: "addStage", name: "verify" });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual([
      "build",
      "test",
      "deploy",
      "verify",
    ]);
  });

  test("l'inverse restaure les octets d'origine", () => {
    roundTrip(BASE, { kind: "addStage", name: "verify" });
    roundTrip(BASE, { kind: "addStage", name: "verify", index: 0 });
    roundTrip("solo:\n  script:\n    - x\n", { kind: "addStage", name: "verify" });
  });

  test("STAGE_EXISTS si le stage est déjà déclaré", () => {
    expectUnchanged(BASE, { kind: "addStage", name: "test" }, "STAGE_EXISTS");
  });

  test("STAGE_EXISTS pour un stage implicite", () => {
    expectUnchanged(
      "solo:\n  script:\n    - x\n",
      { kind: "addStage", name: "build" },
      "STAGE_EXISTS",
    );
  });

  test("INVALID_NAME si le nom est vide", () => {
    expectUnchanged(BASE, { kind: "addStage", name: "" }, "INVALID_NAME");
  });

  test("RANGE_OUT_OF_BOUNDS si l'index dépasse la liste", () => {
    expectUnchanged(BASE, { kind: "addStage", name: "verify", index: 99 }, "RANGE_OUT_OF_BOUNDS");
  });
});
