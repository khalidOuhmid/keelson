import { describe, expect, test } from "bun:test";
import { BASE, expectOk, expectUnchanged, jobOf, roundTrip } from "../support/apply.ts";

const deux = [
  "stages:",
  "  - build",
  "  - test",
  "",
  "compile:",
  "  stage: build",
  "  script:",
  "    - make",
  "",
  "paquet:",
  "  stage: build",
  "  script:",
  "    - pack",
  "",
  "unit:",
  "  stage: test",
  "  needs:",
  "    - compile",
  "    - paquet",
  "  script:",
  "    - check",
  "",
].join("\n");

describe("removeNeed", () => {
  test("retire l'item visé en gardant les autres", () => {
    const applied = expectOk(deux, { kind: "removeNeed", id: "unit", job: "compile" });
    expect(jobOf(applied.text, "unit").needs?.value).toEqual([
      { job: "paquet", optional: false, artifacts: true },
    ]);
  });

  test("retire la ligne complète de l'item", () => {
    const applied = expectOk(deux, { kind: "removeNeed", id: "unit", job: "compile" });
    expect(applied.text).toContain("  needs:\n    - paquet\n");
  });

  test("retire la clé needs entière quand c'était le dernier item", () => {
    const applied = expectOk(BASE, { kind: "removeNeed", id: "unit", job: "compile" });
    expect(jobOf(applied.text, "unit").needs).toBeNull();
    expect(applied.text).not.toContain("needs");
  });

  test("retire un item en forme objet", () => {
    const objet = deux.replace("    - compile\n", "    - job: compile\n      artifacts: false\n");
    const applied = expectOk(objet, { kind: "removeNeed", id: "unit", job: "compile" });
    expect(jobOf(applied.text, "unit").needs?.value).toEqual([
      { job: "paquet", optional: false, artifacts: true },
    ]);
  });

  test("retire un item d'une séquence en flow style", () => {
    const flow = deux.replace(
      "  needs:\n    - compile\n    - paquet\n",
      "  needs: [compile, paquet]\n",
    );
    const applied = expectOk(flow, { kind: "removeNeed", id: "unit", job: "compile" });
    expect(jobOf(applied.text, "unit").needs?.value).toEqual([
      { job: "paquet", optional: false, artifacts: true },
    ]);
  });

  test("écrit une surcharge locale quand les needs sont hérités", () => {
    const herite = [
      ".base:",
      "  needs:",
      "    - compile",
      "    - paquet",
      "",
      "stages:",
      "  - build",
      "  - test",
      "",
      "compile:",
      "  stage: build",
      "  script:",
      "    - make",
      "",
      "paquet:",
      "  stage: build",
      "  script:",
      "    - pack",
      "",
      "unit:",
      "  extends: .base",
      "  stage: test",
      "  script:",
      "    - check",
      "",
    ].join("\n");
    const applied = expectOk(herite, { kind: "removeNeed", id: "unit", job: "compile" });
    expect(applied.text).toContain(".base:\n  needs:\n    - compile\n    - paquet\n");
    const needs = jobOf(applied.text, "unit").needs;
    expect(needs?.origin).toEqual({ kind: "local" });
    expect(needs?.value).toEqual([{ job: "paquet", optional: false, artifacts: true }]);
  });

  test("l'inverse restaure les octets d'origine", () => {
    roundTrip(deux, { kind: "removeNeed", id: "unit", job: "compile" });
    roundTrip(BASE, { kind: "removeNeed", id: "unit", job: "compile" });
  });

  test("JOB_NOT_FOUND si le job n'existe pas", () => {
    expectUnchanged(deux, { kind: "removeNeed", id: "absent", job: "compile" }, "JOB_NOT_FOUND");
  });

  test("NEED_NOT_FOUND si le need n'est pas présent", () => {
    expectUnchanged(deux, { kind: "removeNeed", id: "unit", job: "absent" }, "NEED_NOT_FOUND");
  });

  test("NEED_NOT_FOUND quand le job n'a aucun need", () => {
    expectUnchanged(deux, { kind: "removeNeed", id: "compile", job: "paquet" }, "NEED_NOT_FOUND");
  });
});
