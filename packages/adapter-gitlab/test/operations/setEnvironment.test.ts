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
  test("replaces a string environment with another string", () => {
    const applied = expectOk(texte, {
      kind: "setEnvironment",
      id: "chaine",
      environment: { name: "staging" },
    });
    expect(jobOf(applied.text, "chaine").environment?.value).toEqual({ name: "staging" });
    expect(applied.text).toContain("environment: staging");
  });

  test("replaces a string with a block when url or action is provided", () => {
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

  test("replaces an existing block", () => {
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

  test("creates the environment key when the job has none", () => {
    const applied = expectOk(texte, {
      kind: "setEnvironment",
      id: "nu",
      environment: { name: "revue" },
    });
    expect(jobOf(applied.text, "nu").environment?.value).toEqual({ name: "revue" });
  });

  test("removes the environment key when null is passed", () => {
    const applied = expectOk(texte, { kind: "setEnvironment", id: "chaine", environment: null });
    expect(jobOf(applied.text, "chaine").environment).toBeNull();
    expect(applied.text).not.toContain("environment: production");
  });

  test("removes a whole environment block when null is passed", () => {
    const applied = expectOk(texte, { kind: "setEnvironment", id: "objet", environment: null });
    expect(jobOf(applied.text, "objet").environment).toBeNull();
    expect(applied.text).not.toContain("staging.exemple.org");
  });

  test("writes a local override when the environment is inherited", () => {
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

  test("the inverse restores the original bytes", () => {
    roundTrip(texte, { kind: "setEnvironment", id: "chaine", environment: { name: "staging" } });
    roundTrip(texte, { kind: "setEnvironment", id: "nu", environment: { name: "revue" } });
    roundTrip(texte, { kind: "setEnvironment", id: "objet", environment: null });
  });

  test("JOB_NOT_FOUND if the job does not exist", () => {
    expectUnchanged(
      texte,
      { kind: "setEnvironment", id: "absent", environment: null },
      "JOB_NOT_FOUND",
    );
  });

  test("INVALID_OPERATION when removing an inherited environment", () => {
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
