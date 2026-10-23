import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EN, MESSAGE_CODES, type MessageCode, render } from "../src/messages/index.ts";

const DIAGNOSTICS_DOC = join(import.meta.dir, "..", "..", "..", "specs", "diagnostics.md");

/** Les codes documentés : première cellule des lignes de table, quand elle est un code en
 *  capitales entre accents graves. Lire le document plutôt qu'une liste parallèle est le point du
 *  test : c'est la documentation qui est le contrat public, pas une copie de la documentation. */
function documentedCodes(): string[] {
  const markdown = readFileSync(DIAGNOSTICS_DOC, "utf8");
  const found = new Set<string>();
  for (const line of markdown.split("\n")) {
    const match = /^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|/.exec(line);
    if (match?.[1] !== undefined) {
      found.add(match[1]);
    }
  }
  return [...found].sort();
}

/** Des `params` représentatifs par code, et par branche pour les codes à `reason`. Le test
 *  d'exhaustivité ci-dessous refuse qu'un code ou une branche n'ait pas son entrée ici. */
const FIXTURES: { [C in MessageCode]: readonly unknown[] } = {
  INVALID_YAML: [{ detail: "All mapping items must start at the same column" }],
  INCLUDE_UNRESOLVED: [{}],
  EXTENDS_TARGET_NOT_FOUND: [{ template: ".absent" }],
  EXTENDS_CYCLE: [{ trail: [".a", ".b", ".a"] }],
  JOB_WITHOUT_SCRIPT: [{ job: "muet" }],
  UNKNOWN_NEED: [{ job: "unit", need: "absent" }],
  NEEDS_CYCLE: [{ cycle: ["a", "c", "b", "a"] }],
  UNKNOWN_STAGE: [{ job: "unit", stage: "verify" }],
  NEED_LATER_STAGE: [{ job: "compile", stage: "build", need: "publish", needStage: "deploy" }],

  STALE_DOCUMENT: [{ expected: "a".repeat(64), received: "b".repeat(64) }],
  JOB_NOT_FOUND: [{ job: "absent" }],
  JOB_REFERENCED: [{ job: "compile", referencedBy: ["unit", "lint"] }],
  NAME_CONFLICT: [{ name: "unit" }],
  INVALID_NAME: [{ reason: "job", name: ".tpl" }, { reason: "stage" }],
  STAGE_NOT_FOUND: [{ stage: "verify" }],
  STAGE_EXISTS: [{ stage: "build" }],
  NEED_EXISTS: [{ job: "unit", need: "compile" }],
  NEED_NOT_FOUND: [{ job: "unit", need: "compile" }],
  CYCLE: [{ operation: "addNeed" }],
  UNSUPPORTED_VERSION: [{ received: 2, supported: 1 }],
  INVALID_OPERATION: [
    { reason: "notAnObject" },
    { reason: "schema", path: "job.stage", detail: "Invalid input: expected string" },
    { reason: "schema", path: "", detail: "Invalid input" },
    { reason: "flowStyleJob", job: "unit" },
    { reason: "jobWithoutScript" },
    { reason: "inheritedEnvironment", job: "deploy", origin: "extends" },
    { reason: "noRootMap" },
    { reason: "wouldBreakYaml", operation: "renameJob" },
    { reason: "unreadableBody" },
    { reason: "missingOpId" },
    { reason: "missingOp" },
  ],
  RANGE_OUT_OF_BOUNDS: [
    { reason: "jobRange", job: "unit" },
    { reason: "stageKey" },
    { reason: "needsKey" },
    { reason: "lastNeed" },
    { reason: "environmentKey" },
    { reason: "stageList" },
    { reason: "emptyStageList" },
    { reason: "stageIndex", index: 7, count: 4 },
    { reason: "textRange", start: 10, end: 90, length: 42 },
  ],

  FORBIDDEN_HOST: [{}],
  FORBIDDEN_TOKEN: [{}],
  METHOD_NOT_ALLOWED: [{ method: "DELETE" }],
  NOT_FOUND: [
    { reason: "unreadableFileName" },
    { reason: "unknownFile", file: ".gitlab-ci.yml" },
    { reason: "missingFile", file: ".gitlab-ci.yml" },
    { reason: "unknownRoute", route: "/api/nope" },
    { reason: "noUiBundle" },
  ],
  PAYLOAD_TOO_LARGE: [{ limitBytes: 1_048_576 }],
  INTERNAL_ERROR: [{}],

  NETWORK_ERROR: [{ detail: "fetch failed" }],
  UNEXPECTED_RESPONSE: [{}],
};

type AnyRenderer = ((params: unknown) => string) | Record<string, (params: unknown) => string>;

function branchesOf(code: MessageCode): string[] {
  const renderer = EN[code] as AnyRenderer;
  return typeof renderer === "function" ? [] : Object.keys(renderer);
}

const rendered = (code: MessageCode, params: unknown): string => render(code, params as never);

describe("registre des messages", () => {
  test("tout code a un message, et tout message a un code", () => {
    const registered: string[] = [...MESSAGE_CODES];
    expect(registered.sort()).toEqual(Object.keys(EN).sort());
  });

  test("l'ensemble des codes est exactement celui de specs/diagnostics.md", () => {
    const documented = documentedCodes();
    const registered: string[] = [...MESSAGE_CODES].sort();

    expect(documented.filter((code) => !registered.includes(code))).toEqual([]);
    expect(registered.filter((code) => !documented.includes(code))).toEqual([]);
  });

  test("chaque code a une fixture, et chaque branche la sienne", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...MESSAGE_CODES].sort());

    for (const code of MESSAGE_CODES) {
      const fixtures = FIXTURES[code];
      expect(fixtures.length).toBeGreaterThan(0);

      const branches = branchesOf(code);
      if (branches.length === 0) {
        continue;
      }
      const covered = new Set(fixtures.map((params) => (params as { reason: string }).reason));
      expect({ code, missing: branches.filter((branch) => !covered.has(branch)) }).toEqual({
        code,
        missing: [],
      });
    }
  });
});

describe("rendu anglais", () => {
  test("aucun rendu ne laisse de trou ni de gabarit", () => {
    for (const code of MESSAGE_CODES) {
      for (const params of FIXTURES[code]) {
        const text = rendered(code, params);
        expect({ code, empty: text.length === 0 }).toEqual({ code, empty: false });
        for (const forbidden of ["undefined", "null", "[object Object]", "${", "{{", "NaN"]) {
          expect({ code, contains: text.includes(forbidden) }).toEqual({ code, contains: false });
        }
      }
    }
  });

  test("aucun rendu ne contient de caractère français", () => {
    const french = /[éèêëàâçùûüôîïœ«»]/i;
    for (const code of MESSAGE_CODES) {
      for (const params of FIXTURES[code]) {
        const text = rendered(code, params);
        expect({ code, french: french.test(text) }).toEqual({ code, french: false });
      }
    }
  });

  test("les params apparaissent dans le texte rendu", () => {
    expect(rendered("JOB_REFERENCED", { job: "compile", referencedBy: ["unit", "lint"] })).toBe(
      'job "compile" is needed by unit, lint',
    );
    expect(rendered("NEEDS_CYCLE", { cycle: ["a", "b", "a"] })).toBe("needs cycle: a → b → a");
    expect(rendered("METHOD_NOT_ALLOWED", { method: "DELETE" })).toBe(
      "method DELETE is not allowed",
    );
  });

  /** Trouvé en migrant l'UI : `ErrorBanner` plantait sur un `JOB_REFERENCED` dont les `params` ne
   *  portaient pas `referencedBy`. Le type l'exige, le fil ne le garantit pas, et l'exception
   *  survenait pendant l'affichage d'une autre erreur. */
  test("un rendu ne lève jamais, même sur des params malformés", () => {
    expect(rendered("JOB_REFERENCED", { job: "compile" })).toBe("unexpected server response");
    expect(rendered("NOT_FOUND", { reason: "inventé" })).toBe("unexpected server response");
    expect(rendered("NEEDS_CYCLE", {})).toBe("unexpected server response");
    expect(rendered("INCLUDE_UNRESOLVED", undefined)).toBe(
      "includes are not resolved: the pipeline shown contains only this local file",
    );
  });

  test("les deux branches d'un code à reason rendent des textes distincts", () => {
    expect(rendered("INVALID_NAME", { reason: "job", name: ".tpl" })).not.toBe(
      rendered("INVALID_NAME", { reason: "stage" }),
    );
    expect(rendered("RANGE_OUT_OF_BOUNDS", { reason: "stageKey" })).not.toBe(
      rendered("RANGE_OUT_OF_BOUNDS", { reason: "needsKey" }),
    );
  });
});
