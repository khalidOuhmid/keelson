import { describe, expect, test } from "bun:test";
import { expectOk, expectUnchanged, jobOf, roundTrip } from "../support/apply.ts";

const texte = [
  "stages:",
  "  - deploy",
  "",
  "chaine:",
  "  stage: deploy",
  "  environment: production",
  "  script:",
  "    - x",
  "",
  "objet:",
  "  stage: deploy",
  "  environment:",
  "    name: staging",
  "    url: https://staging.exemple.org",
  "  script:",
  "    - y",
  "",
  "nu:",
  "  stage: deploy",
  "  script:",
  "    - z",
  "",
].join("\n");

describe("setEnvironment", () => {
  test("remplace un environnement en chaîne par une autre chaîne", () => {
    const applied = expectOk(texte, {
      kind: "setEnvironment",
      id: "chaine",
      environment: { name: "staging" },
    });
    expect(jobOf(applied.text, "chaine").environment?.value).toEqual({ name: "staging" });
    expect(applied.text).toContain("environment: staging");
  });

  test("remplace une chaîne par un bloc quand url ou action sont fournis", () => {
    const applied = expectOk(texte, {
      kind: "setEnvironment",
      id: "chaine",
      environment: { name: "production", url: "https://exemple.org" },
    });
    expect(jobOf(applied.text, "chaine").environment?.value).toEqual({
      name: "production",
      url: "https://exemple.org",
    });
  });

  test("remplace un bloc existant", () => {
    const applied = expectOk(texte, {
      kind: "setEnvironment",
      id: "objet",
      environment: { name: "prod", url: "https://prod.exemple.org", action: "start" },
    });
    expect(jobOf(applied.text, "objet").environment?.value).toEqual({
      name: "prod",
      url: "https://prod.exemple.org",
      action: "start",
    });
  });

  test("crée la clé environment quand le job n'en a pas", () => {
    const applied = expectOk(texte, {
      kind: "setEnvironment",
      id: "nu",
      environment: { name: "revue" },
    });
    expect(jobOf(applied.text, "nu").environment?.value).toEqual({ name: "revue" });
  });

  test("retire la clé environment quand on passe null", () => {
    const applied = expectOk(texte, { kind: "setEnvironment", id: "chaine", environment: null });
    expect(jobOf(applied.text, "chaine").environment).toBeNull();
    expect(applied.text).not.toContain("environment: production");
  });

  test("retire un bloc environment entier quand on passe null", () => {
    const applied = expectOk(texte, { kind: "setEnvironment", id: "objet", environment: null });
    expect(jobOf(applied.text, "objet").environment).toBeNull();
    expect(applied.text).not.toContain("staging.exemple.org");
  });

  test("écrit une surcharge locale quand l'environnement est hérité", () => {
    const herite = [
      ".base:",
      "  environment:",
      "    name: herite",
      "    url: https://herite.exemple.org",
      "",
      "stages:",
      "  - deploy",
      "",
      "boulot:",
      "  extends: .base",
      "  stage: deploy",
      "  script:",
      "    - x",
      "",
    ].join("\n");
    const applied = expectOk(herite, {
      kind: "setEnvironment",
      id: "boulot",
      environment: { name: "surcharge" },
    });
    expect(applied.text).toContain(".base:\n  environment:\n    name: herite");
    expect(jobOf(applied.text, "boulot").environment).toEqual({
      value: { name: "surcharge" },
      origin: { kind: "local" },
    });
  });

  test("l'inverse restaure les octets d'origine", () => {
    roundTrip(texte, { kind: "setEnvironment", id: "chaine", environment: { name: "staging" } });
    roundTrip(texte, { kind: "setEnvironment", id: "nu", environment: { name: "revue" } });
    roundTrip(texte, { kind: "setEnvironment", id: "objet", environment: null });
  });

  test("JOB_NOT_FOUND si le job n'existe pas", () => {
    expectUnchanged(
      texte,
      { kind: "setEnvironment", id: "absent", environment: null },
      "JOB_NOT_FOUND",
    );
  });

  test("INVALID_OPERATION si on retire un environnement hérité", () => {
    const herite = [
      ".base:",
      "  environment:",
      "    name: herite",
      "",
      "stages:",
      "  - deploy",
      "",
      "boulot:",
      "  extends: .base",
      "  stage: deploy",
      "  script:",
      "    - x",
      "",
    ].join("\n");
    expectUnchanged(
      herite,
      { kind: "setEnvironment", id: "boulot", environment: null },
      "INVALID_OPERATION",
    );
  });
});
