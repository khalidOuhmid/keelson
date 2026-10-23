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

type Case = { params: unknown; text: string };

/** Des `params` représentatifs **et le texte attendu**, par code et par branche.
 *
 *  Le texte attendu est là parce qu'il est la seule assertion qui tienne réellement `en.ts`. La
 *  revue indépendante du 2026-10-22 a cassé `EXTENDS_CYCLE` — une faute de nom de `params` — sans
 *  faire rougir un seul test : le repli de `render()` changeait l'exception en phrase valide, et
 *  les gardes « non vide, pas d'`undefined`, pas de français » étaient tous satisfaits par ce
 *  repli. Les cas ci-dessous sont donc exercés **sans** le repli, par `EN` directement. */
const FIXTURES: { [C in MessageCode]: readonly Case[] } = {
  INVALID_YAML: [
    {
      params: { detail: "All mapping items must start at the same column" },
      text: "All mapping items must start at the same column",
    },
  ],
  INCLUDE_UNRESOLVED: [
    {
      params: {},
      text: "includes are not resolved: the pipeline shown contains only this local file",
    },
  ],
  EXTENDS_TARGET_NOT_FOUND: [
    {
      params: { template: ".absent" },
      text: 'extends target ".absent" does not exist in this file',
    },
  ],
  EXTENDS_CYCLE: [{ params: { trail: [".a", ".b", ".a"] }, text: "extends cycle: .a → .b → .a" }],
  JOB_WITHOUT_SCRIPT: [
    { params: { job: "muet" }, text: 'job "muet" has no script, no run and no trigger' },
  ],
  UNKNOWN_NEED: [
    {
      params: { job: "unit", need: "absent" },
      text: 'job "unit" needs "absent", which does not exist',
    },
  ],
  NEEDS_CYCLE: [{ params: { cycle: ["a", "c", "b", "a"] }, text: "needs cycle: a → c → b → a" }],
  UNKNOWN_STAGE: [
    {
      params: { job: "unit", stage: "verify" },
      text: 'job "unit" references stage "verify", which is not declared',
    },
  ],
  NEED_LATER_STAGE: [
    {
      params: { job: "compile", stage: "build", need: "publish", needStage: "deploy" },
      text: 'job "compile" (stage "build") needs "publish", which is in the later stage "deploy"',
    },
  ],

  STALE_DOCUMENT: [
    {
      params: { expected: "a".repeat(64), received: "b".repeat(64) },
      text: "the document changed since the operation was computed",
    },
  ],
  JOB_NOT_FOUND: [{ params: { job: "absent" }, text: 'job "absent" does not exist in this file' }],
  JOB_REFERENCED: [
    {
      params: { job: "compile", referencedBy: ["unit", "lint"] },
      text: 'job "compile" is needed by unit, lint',
    },
  ],
  NAME_CONFLICT: [{ params: { name: "unit" }, text: 'key "unit" already exists in this file' }],
  INVALID_NAME: [
    { params: { reason: "job", name: ".tpl" }, text: '".tpl" is not a usable job name' },
    { params: { reason: "stage" }, text: "a stage name cannot be empty" },
  ],
  STAGE_NOT_FOUND: [{ params: { stage: "verify" }, text: 'stage "verify" is not declared' }],
  STAGE_EXISTS: [{ params: { stage: "build" }, text: 'stage "build" already exists' }],
  NEED_EXISTS: [
    { params: { job: "unit", need: "compile" }, text: 'job "unit" already needs "compile"' },
  ],
  NEED_NOT_FOUND: [
    {
      params: { reason: "notNeeded", job: "unit", need: "compile" },
      text: 'job "unit" does not need "compile"',
    },
    {
      params: { reason: "notLocal", job: "unit", need: "compile" },
      text: 'job "unit" needs "compile" through an anchor or a !reference, so removing it would mean rewriting that shared list',
    },
  ],
  CYCLE: [
    { params: { operation: "addNeed" }, text: "operation addNeed would create a cycle in needs" },
  ],
  UNSUPPORTED_VERSION: [
    {
      params: { received: 2, supported: 1 },
      text: "operation version 2 is not supported, expected 1",
    },
  ],
  INVALID_OPERATION: [
    { params: { reason: "notAnObject" }, text: "an operation must be a JSON object" },
    {
      params: { reason: "schema", path: "job.stage", detail: "Invalid input: expected string" },
      text: "job.stage: Invalid input: expected string",
    },
    { params: { reason: "schema", path: "", detail: "Invalid input" }, text: "Invalid input" },
    {
      params: { reason: "flowStyleJob", job: "unit" },
      text: 'job "unit" is written in flow style, in-place editing is not supported',
    },
    {
      params: { reason: "jobWithoutScript" },
      text: "an added job must have at least one script line",
    },
    {
      params: { reason: "inheritedEnvironment", job: "deploy", origin: "extends" },
      text: 'the environment of "deploy" is inherited (extends) and cannot be removed locally',
    },
    { params: { reason: "noRootMap" }, text: "this file has no YAML map at its root" },
    {
      params: { reason: "wouldBreakYaml", operation: "renameJob" },
      text: "operation renameJob would produce invalid YAML, nothing was written",
    },
    { params: { reason: "unreadableBody" }, text: "request body is not readable JSON" },
    { params: { reason: "missingOpId" }, text: "opId is missing or empty" },
    { params: { reason: "missingOp" }, text: "op is missing or invalid" },
  ],
  RANGE_OUT_OF_BOUNDS: [
    { params: { reason: "jobRange", job: "unit" }, text: 'no source range found for job "unit"' },
    { params: { reason: "stageKey" }, text: "no source range found for the stage key" },
    { params: { reason: "needsKey" }, text: "no source range found for the needs key" },
    { params: { reason: "lastNeed" }, text: "no source range found for the last need" },
    { params: { reason: "environmentKey" }, text: "no source range found for the environment key" },
    { params: { reason: "stageList" }, text: "no source range found in the stage list" },
    { params: { reason: "emptyStageList" }, text: "the stage list is empty" },
    {
      params: { reason: "stageIndex", index: 7, count: 4 },
      text: "index 7 is outside a list of 4 stages",
    },
    {
      params: { reason: "textRange", start: 10, end: 90, length: 42 },
      text: "range [10, 90) is outside a text of 42 characters",
    },
  ],

  FORBIDDEN_HOST: [{ params: {}, text: "the local server refused the Host header" }],
  FORBIDDEN_TOKEN: [{ params: {}, text: "the session token is missing or invalid" }],
  METHOD_NOT_ALLOWED: [{ params: { method: "DELETE" }, text: "method DELETE is not allowed" }],
  NOT_FOUND: [
    { params: { reason: "unreadableFileName" }, text: "the file name cannot be decoded" },
    {
      params: { reason: "unknownFile", file: ".gitlab-ci.yml" },
      text: "unknown file: .gitlab-ci.yml",
    },
    {
      params: { reason: "missingFile", file: ".gitlab-ci.yml" },
      text: "file not found: .gitlab-ci.yml",
    },
    { params: { reason: "unknownRoute", route: "/api/nope" }, text: "unknown route: /api/nope" },
    { params: { reason: "noUiBundle" }, text: "this server does not serve an interface bundle" },
  ],
  PAYLOAD_TOO_LARGE: [
    { params: { limitBytes: 1_048_576 }, text: "request body is larger than 1048576 bytes" },
  ],
  INTERNAL_ERROR: [{ params: {}, text: "internal server error" }],

  NETWORK_ERROR: [{ params: { detail: "fetch failed" }, text: "network error: fetch failed" }],
  UNEXPECTED_RESPONSE: [{ params: {}, text: "unexpected server response" }],
};

type AnyRenderer = ((params: unknown) => string) | Record<string, (params: unknown) => string>;

function branchesOf(code: MessageCode): string[] {
  const renderer = EN[code] as AnyRenderer;
  return typeof renderer === "function" ? [] : Object.keys(renderer);
}

/** Appelle le renderer **sans** passer par `render()`, donc sans son repli : une exception ou une
 *  valeur absente remonte au test au lieu d'être changée en phrase valide. */
function renderDirect(code: MessageCode, params: unknown): unknown {
  const renderer = EN[code] as AnyRenderer;
  if (typeof renderer === "function") {
    return renderer(params);
  }
  const branch = renderer[(params as { reason: string }).reason];
  if (branch === undefined) {
    throw new Error(`branche absente pour ${code}`);
  }
  return branch(params);
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
      const cases = FIXTURES[code];
      expect(cases.length).toBeGreaterThan(0);

      const branches = branchesOf(code);
      if (branches.length === 0) {
        continue;
      }
      const covered = new Set(cases.map((entry) => (entry.params as { reason: string }).reason));
      expect({ code, missing: branches.filter((branch) => !covered.has(branch)) }).toEqual({
        code,
        missing: [],
      });
    }
  });
});

describe("rendu anglais", () => {
  /** L'assertion forte du module : chaque branche de chaque code rend **exactement** ce texte,
   *  renderer appelé directement. Changer une phrase de `en.ts` fait rougir ici, et c'est voulu —
   *  les formulations sont du produit, pas un détail d'implémentation. */
  test("chaque branche rend exactement son texte", () => {
    for (const code of MESSAGE_CODES) {
      for (const entry of FIXTURES[code]) {
        expect({ code, text: renderDirect(code, entry.params) }).toEqual({
          code,
          text: entry.text,
        });
      }
    }
  });

  test("aucun rendu ne laisse de trou ni de gabarit", () => {
    for (const code of MESSAGE_CODES) {
      for (const entry of FIXTURES[code]) {
        const text = renderDirect(code, entry.params);
        expect({ code, type: typeof text }).toEqual({ code, type: "string" });
        expect({ code, empty: String(text).length === 0 }).toEqual({ code, empty: false });
        for (const forbidden of ["undefined", "null", "[object Object]", "${", "{{", "NaN"]) {
          expect({ code, contains: String(text).includes(forbidden) }).toEqual({
            code,
            contains: false,
          });
        }
      }
    }
  });

  test("aucun rendu ne contient de caractère français", () => {
    const french = /[éèêëàâçùûüôîïœ«»]/i;
    for (const code of MESSAGE_CODES) {
      for (const entry of FIXTURES[code]) {
        expect({ code, french: french.test(String(renderDirect(code, entry.params))) }).toEqual({
          code,
          french: false,
        });
      }
    }
  });

  /** Trouvé en migrant l'UI : `ErrorBanner` plantait sur un `JOB_REFERENCED` dont les `params` ne
   *  portaient pas `referencedBy`. Le type l'exige, le fil ne le garantit pas, et l'exception
   *  survenait pendant l'affichage d'une autre erreur.
   *
   *  Les cas `INVALID_YAML` viennent de la revue du 2026-10-22 : c'est le seul renderer dont le
   *  corps est une lecture de `params` nue, donc il ne levait pas — il rendait `undefined`, que la
   *  CLI passait ensuite à `.replace()`. Le `try/catch` ne suffisait pas : `render()` doit aussi
   *  refuser ce que le renderer rend quand ce n'est pas une phrase. */
  test("un rendu ne lève jamais et rend toujours une phrase", () => {
    expect(rendered("JOB_REFERENCED", { job: "compile" })).toBe("unexpected server response");
    expect(rendered("NOT_FOUND", { reason: "inventé" })).toBe("unexpected server response");
    expect(rendered("NEEDS_CYCLE", {})).toBe("unexpected server response");
    expect(rendered("INVALID_YAML", {})).toBe("unexpected server response");
    expect(rendered("INVALID_YAML", { detail: "   " })).toBe("unexpected server response");
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
