import { describe, expect, test } from "bun:test";
import type { ApiFailure } from "../../src/api/client.ts";
import {
  addJob,
  addNeed,
  addStage,
  moveStage,
  referencedBy,
  removeJob,
  removeNeed,
  renameJob,
  scriptLines,
  setEnvironment,
  setJobStage,
} from "../../src/editing/drafts.ts";

describe("scriptLines", () => {
  test("découpe sur les retours à la ligne", () => {
    expect(scriptLines("npm ci\nnpm test")).toEqual(["npm ci", "npm test"]);
  });

  test("retire les lignes vides et les espaces de fin", () => {
    expect(scriptLines("  npm ci  \n\n\n  npm test\n")).toEqual(["npm ci", "npm test"]);
  });

  test("accepte les fins de ligne CRLF", () => {
    expect(scriptLines("npm ci\r\nnpm test")).toEqual(["npm ci", "npm test"]);
  });

  test("un texte vide rend une liste vide", () => {
    expect(scriptLines("   \n  \n")).toEqual([]);
  });

  test("ne touche pas aux espaces internes", () => {
    expect(scriptLines("echo  'deux  espaces'")).toEqual(["echo  'deux  espaces'"]);
  });
});

describe("addJob", () => {
  test("construit l'opération avec le script découpé", () => {
    expect(addJob({ id: "unit", stage: "test", script: "npm ci\nnpm test" })).toEqual({
      kind: "addJob",
      job: { id: "unit", stage: "test", script: ["npm ci", "npm test"] },
    });
  });

  test("n'ajoute pas de clé needs quand il n'y en a pas", () => {
    const draft = addJob({ id: "unit", stage: "test", script: "x" });
    expect("needs" in (draft as { job: object }).job).toBe(false);
  });

  test("porte les needs demandés", () => {
    const draft = addJob({ id: "unit", stage: "test", script: "x", needs: ["compile"] });
    expect(draft).toEqual({
      kind: "addJob",
      job: { id: "unit", stage: "test", script: ["x"], needs: [{ job: "compile" }] },
    });
  });

  test("porte l'environnement demandé", () => {
    const draft = addJob({
      id: "ship",
      stage: "deploy",
      script: "x",
      environment: { name: "production" },
    });
    expect(draft).toEqual({
      kind: "addJob",
      job: {
        id: "ship",
        stage: "deploy",
        script: ["x"],
        environment: { name: "production" },
      },
    });
  });

  test("laisse passer un identifiant vide : la légalité est au serveur", () => {
    expect(addJob({ id: "", stage: "test", script: "x" })).toEqual({
      kind: "addJob",
      job: { id: "", stage: "test", script: ["x"] },
    });
  });
});

describe("opérations de job", () => {
  test("renameJob", () => {
    expect(renameJob("unit", "tests")).toEqual({ kind: "renameJob", from: "unit", to: "tests" });
  });

  test("removeJob", () => {
    expect(removeJob("unit")).toEqual({ kind: "removeJob", id: "unit" });
  });

  test("setJobStage", () => {
    expect(setJobStage("unit", "verify")).toEqual({
      kind: "setJobStage",
      id: "unit",
      stage: "verify",
    });
  });
});

describe("opérations de needs", () => {
  test("addNeed sans option n'écrit que le job", () => {
    expect(addNeed("unit", "compile")).toEqual({
      kind: "addNeed",
      id: "unit",
      need: { job: "compile" },
    });
  });

  test("addNeed porte optional quand il est demandé", () => {
    expect(addNeed("unit", "compile", { optional: true })).toEqual({
      kind: "addNeed",
      id: "unit",
      need: { job: "compile", optional: true },
    });
  });

  test("addNeed porte artifacts quand il est désactivé", () => {
    expect(addNeed("unit", "compile", { artifacts: false })).toEqual({
      kind: "addNeed",
      id: "unit",
      need: { job: "compile", artifacts: false },
    });
  });

  test("addNeed n'écrit pas les valeurs par défaut", () => {
    expect(addNeed("unit", "compile", { optional: false, artifacts: true })).toEqual({
      kind: "addNeed",
      id: "unit",
      need: { job: "compile" },
    });
  });

  test("removeNeed", () => {
    expect(removeNeed("unit", "compile")).toEqual({
      kind: "removeNeed",
      id: "unit",
      job: "compile",
    });
  });
});

describe("environnement", () => {
  test("setEnvironment avec un nom seul", () => {
    expect(setEnvironment("ship", { name: "production" })).toEqual({
      kind: "setEnvironment",
      id: "ship",
      environment: { name: "production" },
    });
  });

  test("setEnvironment avec url et action", () => {
    expect(
      setEnvironment("ship", { name: "staging", url: "https://s.example.org", action: "start" }),
    ).toEqual({
      kind: "setEnvironment",
      id: "ship",
      environment: { name: "staging", url: "https://s.example.org", action: "start" },
    });
  });

  test("setEnvironment ignore les champs vides plutôt que d'écrire une chaîne vide", () => {
    expect(setEnvironment("ship", { name: "staging", url: "", action: "  " })).toEqual({
      kind: "setEnvironment",
      id: "ship",
      environment: { name: "staging" },
    });
  });

  test("setEnvironment à null retire l'environnement", () => {
    expect(setEnvironment("ship", null)).toEqual({
      kind: "setEnvironment",
      id: "ship",
      environment: null,
    });
  });
});

describe("opérations de stages", () => {
  test("addStage sans index", () => {
    expect(addStage("verify")).toEqual({ kind: "addStage", name: "verify" });
  });

  test("addStage avec index", () => {
    expect(addStage("verify", 1)).toEqual({ kind: "addStage", name: "verify", index: 1 });
  });

  test("addStage accepte l'index zéro", () => {
    expect(addStage("prepare", 0)).toEqual({ kind: "addStage", name: "prepare", index: 0 });
  });

  test("moveStage", () => {
    expect(moveStage("deploy", 0)).toEqual({ kind: "moveStage", name: "deploy", toIndex: 0 });
  });
});

describe("referencedBy", () => {
  /** Les `params` viennent du réseau : le cast est là pour reproduire ce qu'un serveur mal luné
   *  peut envoyer sous un code dont le type promet mieux. */
  function failure(params: unknown): ApiFailure {
    return { status: 422, code: "JOB_REFERENCED", params } as ApiFailure;
  }

  test("extrait la liste des jobs qui référencent la cible", () => {
    expect(referencedBy(failure({ referencedBy: ["unit", "ship"] }))).toEqual(["unit", "ship"]);
  });

  test("rend une liste vide quand referencedBy est absent", () => {
    expect(referencedBy(failure({ job: "compile" }))).toEqual([]);
  });

  test("rend une liste vide quand les params n'ont pas la bonne forme", () => {
    expect(referencedBy(failure({ autre: 1 }))).toEqual([]);
    expect(referencedBy(failure("texte"))).toEqual([]);
    expect(referencedBy(failure({ referencedBy: "unit" }))).toEqual([]);
  });

  test("ignore les entrées non textuelles", () => {
    expect(referencedBy(failure({ referencedBy: ["unit", 42, null] }))).toEqual(["unit"]);
  });
});
