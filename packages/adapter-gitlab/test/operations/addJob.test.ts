import { describe, expect, test } from "bun:test";
import { BASE, expectOk, expectUnchanged, jobOf, roundTrip } from "../support/apply.ts";

const minimal = {
  kind: "addJob" as const,
  job: { id: "paquet", stage: "deploy", script: ["make package"] },
};

describe("addJob", () => {
  test("insère le job en fin de fichier après une ligne vide", () => {
    const applied = expectOk(BASE, minimal);
    expect(applied.text).toStartWith(BASE);
    expect(applied.text.slice(BASE.length)).toBe(
      "\npaquet:\n  stage: deploy\n  script:\n    - make package\n",
    );
  });

  test("le job inséré est présent dans l'IR rendue", () => {
    const applied = expectOk(BASE, minimal);
    const added = applied.pipeline.jobs.find((job) => job.id === "paquet");
    expect(added?.stage.value).toBe("deploy");
    expect(added?.stage.origin).toEqual({ kind: "local" });
  });

  test("rend un YAML qui reparse sans erreur", () => {
    const applied = expectOk(BASE, minimal);
    expect(applied.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  test("écrit les needs demandés", () => {
    const applied = expectOk(BASE, {
      kind: "addJob",
      job: { id: "paquet", stage: "deploy", script: ["x"], needs: [{ job: "compile" }] },
    });
    expect(jobOf(applied.text, "paquet").needs?.value).toEqual([
      { job: "compile", optional: false, artifacts: true },
    ]);
  });

  test("écrit un need en forme objet quand il porte des options", () => {
    const applied = expectOk(BASE, {
      kind: "addJob",
      job: {
        id: "paquet",
        stage: "deploy",
        script: ["x"],
        needs: [{ job: "compile", optional: true, artifacts: false }],
      },
    });
    expect(jobOf(applied.text, "paquet").needs?.value).toEqual([
      { job: "compile", optional: true, artifacts: false },
    ]);
  });

  test("écrit l'environnement demandé", () => {
    const applied = expectOk(BASE, {
      kind: "addJob",
      job: {
        id: "livre",
        stage: "deploy",
        script: ["x"],
        environment: { name: "production", url: "https://exemple.org" },
      },
    });
    expect(jobOf(applied.text, "livre").environment?.value).toEqual({
      name: "production",
      url: "https://exemple.org",
    });
  });

  test("respecte l'indentation détectée du fichier", () => {
    const quatre = BASE.replaceAll("\n  ", "\n    ").replaceAll("\n      - ", "\n        - ");
    const applied = expectOk(quatre, minimal);
    expect(applied.text.slice(quatre.length)).toContain("\n    stage: deploy");
  });

  test("ajoute un retour à la ligne si le fichier n'en a pas en fin", () => {
    const sansEol = BASE.trimEnd();
    const applied = expectOk(sansEol, minimal);
    expect(applied.text).toContain("\n\npaquet:\n");
    expect(jobOf(applied.text, "paquet").id).toBe("paquet");
  });

  test("préserve les fins de ligne CRLF", () => {
    const crlf = BASE.replaceAll("\n", "\r\n");
    const applied = expectOk(crlf, minimal);
    expect(applied.text.slice(crlf.length)).not.toContain("\n\n");
    expect(applied.text.slice(crlf.length)).toContain("\r\n");
  });

  test("l'inverse restaure les octets d'origine", () => {
    roundTrip(BASE, minimal);
    roundTrip(BASE.trimEnd(), minimal);
  });

  test("touched couvre uniquement le texte ajouté", () => {
    const applied = expectOk(BASE, minimal);
    expect(applied.touched).toHaveLength(1);
    expect(applied.text.slice(0, applied.touched[0]?.start)).toBe(BASE);
  });

  test("NAME_CONFLICT si le job existe déjà", () => {
    expectUnchanged(
      BASE,
      {
        kind: "addJob",
        job: { id: "compile", stage: "build", script: ["x"] },
      },
      "NAME_CONFLICT",
    );
  });

  test("NAME_CONFLICT si un template porte ce nom", () => {
    const avecTemplate = `.base:\n  image: node\n\n${BASE}`;
    expectUnchanged(
      avecTemplate,
      {
        kind: "addJob",
        job: { id: ".base", stage: "build", script: ["x"] },
      },
      "INVALID_NAME",
    );
  });

  test("INVALID_NAME si le nom est vide", () => {
    expectUnchanged(
      BASE,
      { kind: "addJob", job: { id: "", stage: "build", script: ["x"] } },
      "INVALID_NAME",
    );
  });

  test("INVALID_NAME si le nom commence par un point", () => {
    expectUnchanged(
      BASE,
      { kind: "addJob", job: { id: ".cache", stage: "build", script: ["x"] } },
      "INVALID_NAME",
    );
  });

  test("INVALID_NAME pour chaque mot réservé", () => {
    for (const reserved of [
      "stages",
      "variables",
      "include",
      "default",
      "workflow",
      "image",
      "services",
      "cache",
      "before_script",
      "after_script",
    ]) {
      expectUnchanged(
        BASE,
        {
          kind: "addJob",
          job: { id: reserved, stage: "build", script: ["x"] },
        },
        "INVALID_NAME",
      );
    }
  });

  test("STAGE_NOT_FOUND si le stage n'est pas déclaré", () => {
    expectUnchanged(
      BASE,
      {
        kind: "addJob",
        job: { id: "paquet", stage: "inconnu", script: ["x"] },
      },
      "STAGE_NOT_FOUND",
    );
  });

  test("INVALID_OPERATION si le script est vide", () => {
    expectUnchanged(
      BASE,
      { kind: "addJob", job: { id: "paquet", stage: "build", script: [] } },
      "INVALID_OPERATION",
    );
  });
});
