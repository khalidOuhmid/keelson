import { describe, expect, test } from "bun:test";
import { expectOk, expectUnchanged, jobOf, roundTrip } from "../support/apply.ts";

const trois = [
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
  "  script:",
  "    - check",
  "",
].join("\n");

describe("addNeed", () => {
  test("ajoute un item à une séquence de needs existante", () => {
    const applied = expectOk(trois, { kind: "addNeed", id: "unit", need: { job: "paquet" } });
    expect(jobOf(applied.text, "unit").needs?.value).toEqual([
      { job: "compile", optional: false, artifacts: true },
      { job: "paquet", optional: false, artifacts: true },
    ]);
  });

  test("conserve les items existants octet pour octet", () => {
    const applied = expectOk(trois, { kind: "addNeed", id: "unit", need: { job: "paquet" } });
    expect(applied.text).toContain("  needs:\n    - compile\n    - paquet\n");
  });

  test("écrit la forme objet quand le need porte des options", () => {
    const applied = expectOk(trois, {
      kind: "addNeed",
      id: "unit",
      need: { job: "paquet", optional: true, artifacts: false },
    });
    expect(jobOf(applied.text, "unit").needs?.value).toContainEqual({
      job: "paquet",
      optional: true,
      artifacts: false,
    });
  });

  test("crée la clé needs quand le job n'en a pas", () => {
    const applied = expectOk(trois, { kind: "addNeed", id: "paquet", need: { job: "compile" } });
    expect(jobOf(applied.text, "paquet").needs?.value).toEqual([
      { job: "compile", optional: false, artifacts: true },
    ]);
  });

  test("ajoute dans une séquence en flow style", () => {
    const flow = trois.replace("  needs:\n    - compile\n", "  needs: [compile]\n");
    const applied = expectOk(flow, { kind: "addNeed", id: "unit", need: { job: "paquet" } });
    expect(applied.text).toContain("needs: [compile, paquet]");
  });

  test("écrit une surcharge locale quand les needs sont hérités", () => {
    const herite = [
      ".base:",
      "  needs:",
      "    - compile",
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
    const applied = expectOk(herite, { kind: "addNeed", id: "unit", need: { job: "paquet" } });
    expect(applied.text).toContain(".base:\n  needs:\n    - compile\n");
    const needs = jobOf(applied.text, "unit").needs;
    expect(needs?.origin).toEqual({ kind: "local" });
    expect(needs?.value).toEqual([
      { job: "compile", optional: false, artifacts: true },
      { job: "paquet", optional: false, artifacts: true },
    ]);
  });

  test("accepte un need optionnel vers un job absent", () => {
    const applied = expectOk(trois, {
      kind: "addNeed",
      id: "unit",
      need: { job: "futur", optional: true },
    });
    expect(jobOf(applied.text, "unit").needs?.value).toContainEqual({
      job: "futur",
      optional: true,
      artifacts: true,
    });
  });

  test("l'inverse restaure les octets d'origine", () => {
    roundTrip(trois, { kind: "addNeed", id: "unit", need: { job: "paquet" } });
    roundTrip(trois, { kind: "addNeed", id: "paquet", need: { job: "compile" } });
  });

  test("JOB_NOT_FOUND si le job n'existe pas", () => {
    expectUnchanged(
      trois,
      { kind: "addNeed", id: "absent", need: { job: "compile" } },
      "JOB_NOT_FOUND",
    );
  });

  test("NEED_EXISTS si le need est déjà présent", () => {
    expectUnchanged(
      trois,
      { kind: "addNeed", id: "unit", need: { job: "compile" } },
      "NEED_EXISTS",
    );
  });

  test("CYCLE si le need crée un cycle", () => {
    expectUnchanged(trois, { kind: "addNeed", id: "compile", need: { job: "unit" } }, "CYCLE");
  });

  test("CYCLE pour un auto-need", () => {
    expectUnchanged(trois, { kind: "addNeed", id: "unit", need: { job: "unit" } }, "CYCLE");
  });
});
