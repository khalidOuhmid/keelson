import { describe, expect, test } from "bun:test";
import { BASE, expectOk, expectUnchanged, jobOf, roundTrip } from "../support/apply.ts";

describe("setJobStage", () => {
  test("remplace la valeur du stage déclaré localement", () => {
    const applied = expectOk(BASE, { kind: "setJobStage", id: "compile", stage: "test" });
    expect(jobOf(applied.text, "compile").stage).toEqual({
      value: "test",
      origin: { kind: "local" },
    });
  });

  test("ne touche qu'une seule plage", () => {
    const applied = expectOk(BASE, { kind: "setJobStage", id: "compile", stage: "test" });
    expect(applied.touched).toHaveLength(1);
    expect(applied.text.slice(applied.touched[0]?.start, applied.touched[0]?.end)).toBe("test");
  });

  test("préserve un commentaire en ligne sur la clé stage", () => {
    const commente = BASE.replace("  stage: build\n", "  stage: build # le stage\n");
    const applied = expectOk(commente, { kind: "setJobStage", id: "compile", stage: "test" });
    expect(applied.text).toContain("stage: test # le stage");
  });

  test("écrit une surcharge locale quand le stage vient du défaut", () => {
    const texte = [
      "stages:",
      "  - build",
      "  - test",
      "",
      "solo:",
      "  script:",
      "    - x",
      "",
    ].join("\n");
    const applied = expectOk(texte, { kind: "setJobStage", id: "solo", stage: "build" });
    expect(jobOf(applied.text, "solo").stage).toEqual({
      value: "build",
      origin: { kind: "local" },
    });
    expect(applied.text).toContain("solo:\n  stage: build\n  script:");
  });

  test("écrit une surcharge locale sans toucher au template hérité", () => {
    const texte = [
      ".base:",
      "  stage: build",
      "",
      "stages:",
      "  - build",
      "  - test",
      "",
      "herite:",
      "  extends: .base",
      "  script:",
      "    - x",
      "",
    ].join("\n");
    const applied = expectOk(texte, { kind: "setJobStage", id: "herite", stage: "test" });
    expect(applied.text).toContain(".base:\n  stage: build");
    expect(jobOf(applied.text, "herite").stage).toEqual({
      value: "test",
      origin: { kind: "local" },
    });
  });

  test("écrit une surcharge locale sans toucher à l'anchor hérité", () => {
    const texte = [
      ".base: &base",
      "  stage: build",
      "",
      "stages:",
      "  - build",
      "  - test",
      "",
      "boulot:",
      "  <<: *base",
      "  script:",
      "    - x",
      "",
    ].join("\n");
    const applied = expectOk(texte, { kind: "setJobStage", id: "boulot", stage: "test" });
    expect(applied.text).toContain(".base: &base\n  stage: build");
    expect(jobOf(applied.text, "boulot").stage.origin).toEqual({ kind: "local" });
  });

  test("l'inverse restaure les octets d'origine", () => {
    roundTrip(BASE, { kind: "setJobStage", id: "compile", stage: "deploy" });
    const texte = ["stages:", "  - build", "", "solo:", "  script:", "    - x", ""].join("\n");
    roundTrip(texte, { kind: "setJobStage", id: "solo", stage: "build" });
  });

  test("JOB_NOT_FOUND si le job n'existe pas", () => {
    expectUnchanged(BASE, { kind: "setJobStage", id: "absent", stage: "test" }, "JOB_NOT_FOUND");
  });

  test("STAGE_NOT_FOUND si le stage n'est pas déclaré", () => {
    expectUnchanged(
      BASE,
      { kind: "setJobStage", id: "compile", stage: "inconnu" },
      "STAGE_NOT_FOUND",
    );
  });

  test("accepte un stage implicite quand stages est absent", () => {
    const texte = "solo:\n  script:\n    - x\n";
    const applied = expectOk(texte, { kind: "setJobStage", id: "solo", stage: "deploy" });
    expect(jobOf(applied.text, "solo").stage.value).toBe("deploy");
  });
});
