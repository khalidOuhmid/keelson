import { describe, expect, test } from "bun:test";
import { BASE, expectOk, expectUnchanged, jobOf, roundTrip } from "../support/apply.ts";

describe("renameJob", () => {
  test("renomme la clé du job", () => {
    const applied = expectOk(BASE, { kind: "renameJob", from: "compile", to: "build-app" });
    expect(applied.pipeline.jobs.map((job) => job.id)).toEqual(["build-app", "unit"]);
  });

  test("met à jour les références en forme chaîne dans les needs", () => {
    const applied = expectOk(BASE, { kind: "renameJob", from: "compile", to: "build-app" });
    expect(jobOf(applied.text, "unit").needs?.value).toEqual([
      { job: "build-app", optional: false, artifacts: true },
    ]);
  });

  test("met à jour les références en forme objet dans les needs", () => {
    const objet = BASE.replace("    - compile\n", "    - job: compile\n      artifacts: false\n");
    const applied = expectOk(objet, { kind: "renameJob", from: "compile", to: "build-app" });
    expect(jobOf(applied.text, "unit").needs?.value).toEqual([
      { job: "build-app", optional: false, artifacts: false },
    ]);
  });

  test("met à jour les références en flow style", () => {
    const flow = BASE.replace("  needs:\n    - compile\n", "  needs: [compile]\n");
    const applied = expectOk(flow, { kind: "renameJob", from: "compile", to: "build-app" });
    expect(applied.text).toContain("needs: [build-app]");
  });

  test("met à jour les références portées par un template", () => {
    const avecTemplate = [".commun:", "  needs:", "    - compile", "", BASE].join("\n");
    const applied = expectOk(avecTemplate, { kind: "renameJob", from: "compile", to: "build-app" });
    expect(applied.text).toContain(".commun:\n  needs:\n    - build-app");
  });

  test("ne touche pas une chaîne homonyme ailleurs dans le fichier", () => {
    const piege = BASE.replace("    - make\n", "    - make compile\n");
    const applied = expectOk(piege, { kind: "renameJob", from: "compile", to: "build-app" });
    expect(applied.text).toContain("- make compile");
  });

  test("ne touche pas un stage homonyme", () => {
    const texte = [
      "stages:",
      "  - compile",
      "",
      "compile:",
      "  stage: compile",
      "  script:",
      "    - make",
      "",
    ].join("\n");
    const applied = expectOk(texte, { kind: "renameJob", from: "compile", to: "autre" });
    expect(applied.pipeline.stages.map((s) => s.name)).toEqual(["compile"]);
    expect(jobOf(applied.text, "autre").stage.value).toBe("compile");
  });

  test("préserve les commentaires du job renommé", () => {
    const commente = BASE.replace("compile:\n", "compile: # un commentaire\n");
    const applied = expectOk(commente, { kind: "renameJob", from: "compile", to: "build-app" });
    expect(applied.text).toContain("build-app: # un commentaire");
  });

  test("l'inverse restaure les octets d'origine", () => {
    roundTrip(BASE, { kind: "renameJob", from: "compile", to: "build-app" });
  });

  test("JOB_NOT_FOUND si la source n'existe pas", () => {
    expectUnchanged(BASE, { kind: "renameJob", from: "absent", to: "x" }, "JOB_NOT_FOUND");
  });

  test("NAME_CONFLICT si la cible existe déjà", () => {
    expectUnchanged(BASE, { kind: "renameJob", from: "compile", to: "unit" }, "NAME_CONFLICT");
  });

  test("INVALID_NAME si la cible est vide, cachée ou réservée", () => {
    for (const to of ["", ".cache", "stages", "variables"]) {
      expectUnchanged(BASE, { kind: "renameJob", from: "compile", to }, "INVALID_NAME");
    }
  });

  test("CYCLE si le renommage crée un cycle de needs", () => {
    const texte = [
      "stages:",
      "  - test",
      "",
      "a:",
      "  stage: test",
      "  needs:",
      "    - futur",
      "  script:",
      "    - x",
      "",
      "b:",
      "  stage: test",
      "  needs:",
      "    - a",
      "  script:",
      "    - y",
      "",
    ].join("\n");
    expectUnchanged(texte, { kind: "renameJob", from: "b", to: "futur" }, "CYCLE");
  });
});
