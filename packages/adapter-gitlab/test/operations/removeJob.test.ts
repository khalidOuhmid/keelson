import { describe, expect, test } from "bun:test";
import { JOB_REFERENCED, renderMessage } from "@keelson/core/messages";
import { BASE, expectOk, expectUnchanged, roundTrip } from "../support/apply.ts";

describe("removeJob", () => {
  test("retire la paire clé/valeur complète du job", () => {
    const applied = expectOk(BASE, { kind: "removeJob", id: "unit" });
    expect(applied.text).toBe(
      [
        "stages:",
        "  - build",
        "  - test",
        "  - deploy",
        "",
        "compile:",
        "  stage: build",
        "  script:",
        "    - make",
        "",
      ].join("\n"),
    );
  });

  test("le job disparaît de l'IR", () => {
    const applied = expectOk(BASE, { kind: "removeJob", id: "unit" });
    expect(applied.pipeline.jobs.map((job) => job.id)).toEqual(["compile"]);
  });

  test("retire aussi la ligne vide de séparation qui suit", () => {
    const sansNeeds = [
      "stages:",
      "  - build",
      "  - test",
      "",
      "compile:",
      "  stage: build",
      "  script:",
      "    - make",
      "",
      "unit:",
      "  stage: test",
      "  script:",
      "    - make check",
      "",
    ].join("\n");
    const applied = expectOk(sansNeeds, { kind: "removeJob", id: "compile" });
    expect(applied.text).toBe(
      [
        "stages:",
        "  - build",
        "  - test",
        "",
        "unit:",
        "  stage: test",
        "  script:",
        "    - make check",
        "",
      ].join("\n"),
    );
  });

  test("préserve le commentaire qui précède le job suivant", () => {
    const avecCommentaire = [
      "stages:",
      "  - build",
      "  - test",
      "",
      "compile:",
      "  stage: build",
      "  script:",
      "    - make",
      "",
      "# à propos de unit",
      "unit:",
      "  stage: test",
      "  script:",
      "    - make check",
      "",
    ].join("\n");
    const applied = expectOk(avecCommentaire, { kind: "removeJob", id: "compile" });
    expect(applied.text).toContain("# à propos de unit");
  });

  test("retire le dernier job d'un fichier", () => {
    const applied = expectOk(BASE, { kind: "removeJob", id: "unit" });
    expect(applied.text.endsWith("    - make\n")).toBe(true);
  });

  test("l'inverse restaure les octets d'origine", () => {
    roundTrip(BASE, { kind: "removeJob", id: "unit" });
  });

  test("JOB_NOT_FOUND si le job n'existe pas", () => {
    expectUnchanged(BASE, { kind: "removeJob", id: "absent" }, "JOB_NOT_FOUND");
  });

  test("JOB_NOT_FOUND pour un template", () => {
    const avecTemplate = `.base:\n  image: node\n\n${BASE}`;
    expectUnchanged(avecTemplate, { kind: "removeJob", id: ".base" }, "JOB_NOT_FOUND");
  });

  test("JOB_REFERENCED si un autre job en a besoin", () => {
    const error = expectUnchanged(BASE, { kind: "removeJob", id: "compile" }, "JOB_REFERENCED");
    expect(renderMessage(error)).toContain("unit");
  });

  test("JOB_REFERENCED liste les jobs qui le référencent dans params", () => {
    const error = expectUnchanged(BASE, { kind: "removeJob", id: "compile" }, "JOB_REFERENCED");
    expect(error.code === JOB_REFERENCED ? error.params.referencedBy : null).toEqual(["unit"]);
  });

  test("retirer d'abord le dépendant permet ensuite de retirer la cible", () => {
    const sansUnit = expectOk(BASE, { kind: "removeJob", id: "unit" });
    const sansRien = expectOk(sansUnit.text, { kind: "removeJob", id: "compile" });
    expect(sansRien.pipeline.jobs).toEqual([]);
  });
});
