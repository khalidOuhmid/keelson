import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EN, MESSAGE_CODES, type MessageCode, render } from "../src/messages/index.ts";

const DIAGNOSTICS_DOC = join(import.meta.dir, "..", "..", "..", "specs", "diagnostics.md");

/** The documented codes: the first cell of table rows, when it is an uppercase code between
 *  backticks. Reading the document rather than a parallel list is the point of the test: the
 *  documentation is the public contract, not a copy of the documentation. */
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

/** Representative `params` **and the expected text**, per code and per branch.
 *
 *  The expected text is here because it is the only assertion that really holds `en.ts` in place.
 *  The independent review of 2026-10-22 broke `EXTENDS_CYCLE` — a misnamed `params` field —
 *  without turning a single test red: the `render()` fallback turned the exception into a valid
 *  sentence, and the "non-empty, no `undefined`, no French" guards were all satisfied by that
 *  fallback. The cases below are therefore exercised **without** the fallback, through `EN`
 *  directly. */
const FIXTURES: { [C in MessageCode]: readonly Case[] } = {
  INVALID_YAML: [
    {
      params: { detail: "All mapping items must start at the same column" },
      text: "All mapping items must start at the same column",
    },
  ],
  INCLUDE_UNRESOLVED: [
    {
      params: { form: "template", detail: "Jobs/SAST.gitlab-ci.yml" },
      text: "this template include is not resolved (Jobs/SAST.gitlab-ci.yml), so the pipeline shown may be incomplete",
    },
    {
      params: { form: "local", detail: "ci/jobs.yml" },
      text: "this local include is not resolved (ci/jobs.yml), so the pipeline shown may be incomplete",
    },
  ],
  INCLUDE_NOT_FOUND: [
    {
      params: { reason: "missing", path: "ci/absent.yml" },
      text: 'included file "ci/absent.yml" does not exist',
    },
    {
      params: { reason: "notYaml", path: "ci/jobs.txt" },
      text: 'included file "ci/jobs.txt" is not a .yml or .yaml file',
    },
    {
      params: { reason: "outsideRoot", path: "../../etc/passwd" },
      text: 'included path "../../etc/passwd" leaves the repository root',
    },
    { params: { reason: "malformed" }, text: "this include entry has no form Keelson understands" },
  ],
  INCLUDE_CYCLE: [
    {
      params: { trail: [".gitlab-ci.yml", "ci/a.yml", ".gitlab-ci.yml"] },
      text: "include cycle: .gitlab-ci.yml → ci/a.yml → .gitlab-ci.yml",
    },
  ],
  INCLUDE_LIMIT_EXCEEDED: [
    {
      params: { limit: 150 },
      text: "more than 150 included files, include resolution stopped there",
    },
  ],
  EXTENDS_TARGET_NOT_FOUND: [
    {
      params: { template: ".absent" },
      text: 'extends target ".absent" does not exist in any resolved file',
    },
  ],
  EXTENDS_CYCLE: [{ params: { trail: [".a", ".b", ".a"] }, text: "extends cycle: .a → .b → .a" }],
  EXTENDS_DEPTH_EXCEEDED: [
    {
      params: { job: "deploy", limit: 11 },
      text: 'job "deploy" inherits through more than 11 levels of extends, which GitLab refuses',
    },
  ],
  VALUE_CYCLE: [
    {
      params: { job: "unit", key: "script" },
      text: 'the script of job "unit" refers to itself through an alias or a !reference',
    },
  ],
  JOB_WITHOUT_SCRIPT: [
    { params: { job: "silent" }, text: 'job "silent" has no script, no run and no trigger' },
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
  LAYOUT_INVALID: [
    {
      params: { detail: "layers: invalid" },
      text: ".devsecops/layout.json is not usable: layers: invalid",
    },
  ],
  LAYOUT_UNKNOWN_LAYER: [
    {
      params: { job: "unit", layer: "x" },
      text: 'layout.json assigns job "unit" to unknown layer "x"',
    },
  ],
  LAYOUT_UNKNOWN_JOB: [
    { params: { job: "unit" }, text: 'layout.json names job "unit", which does not exist' },
  ],
  COVERAGE_LAYER_MISSING: [
    {
      params: { layer: "sast", name: "Static analysis" },
      text: 'required layer "sast" (Static analysis) is not covered',
    },
  ],
  CATALOG_INVALID_TOOL: [
    { params: { detail: "id: invalid" }, text: "invalid tool file: id: invalid" },
  ],
  CATALOG_DUPLICATE_TOOL: [{ params: { tool: "x" }, text: 'tool id "x" is declared twice' }],
  CATALOG_UNKNOWN_LOGO: [
    { params: { tool: "x", logo: "y" }, text: 'tool "x" names unknown logo "y"' },
  ],
  CATALOG_MISSING_SNIPPET: [{ params: { tool: "x" }, text: 'job tool "x" has no snippet' }],
  CATALOG_STALE_TOOL: [
    {
      params: { tool: "x", lastVerified: "2026-01-01" },
      text: 'tool "x" was last verified on 2026-01-01, more than six months ago',
    },
  ],

  WORKFLOW_UNRESOLVED: [
    {
      params: { job: "call", target: "o/r/.github/workflows/x.yml@v1" },
      text: 'job "call" calls the reusable workflow "o/r/.github/workflows/x.yml@v1", which Keelson does not read, so its jobs are not shown',
    },
  ],
  TOOLCHAIN_INVALID: [
    {
      params: { detail: "version: Invalid input" },
      text: ".devsecops/toolchain.yaml is not usable: version: Invalid input",
    },
  ],
  TOOLCHAIN_UNKNOWN_TOOL: [
    {
      params: { service: "n", tool: "x" },
      text: 'service "n" names "x", which is not in the catalog',
    },
  ],
  TOOLCHAIN_UNKNOWN_SERVICE: [
    {
      params: { job: "b", service: "n" },
      text: 'job "b" is integrated with "n", which is not a declared service',
    },
  ],
  TOOLCHAIN_UNKNOWN_JOB: [
    { params: { job: "b" }, text: 'toolchain.yaml names job "b", which does not exist' },
  ],
  TOOLCHAIN_DUPLICATE_INTEGRATION: [
    {
      params: { job: "b", service: "n", kind: "push" },
      text: 'the push integration of "b" with "n" is listed twice',
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
    { params: { reason: "service", name: "A" }, text: '"A" is not a usable service name' },
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
      params: { reason: "flowStyleToolchain", section: "services" },
      text: "the services section is written in flow style, in-place editing is not supported",
    },
    {
      params: { reason: "invalidToolchain" },
      text: "toolchain.yaml is not usable, fix it before editing it here",
    },
    {
      params: { reason: "invalidSnippet" },
      text: "this snippet is not a single job Keelson can copy as it is",
    },
    {
      params: { reason: "citedInExpression", job: "build" },
      text: 'job "build" is cited in an expression that Keelson cannot rewrite, so this change would break it',
    },
    {
      params: { reason: "dynamicExpression", job: "build" },
      text: 'an expression reads needs or jobs as a whole or by a computed index, so it may reach "build": Keelson refuses rather than break it',
    },
    {
      params: { reason: "notForProvider", operation: "addStage" },
      text: "operation addStage has no meaning in a GitHub Actions workflow",
    },
    {
      params: { reason: "invalidLayout" },
      text: "layout.json is not usable, fix it before moving nodes",
    },
    {
      params: { reason: "outsideRoot", path: ".devsecops/toolchain.yaml" },
      text: '".devsecops/toolchain.yaml" leads outside the repository, nothing was written',
    },
    {
      params: { reason: "sharedValue", job: "unit", key: "needs" },
      text: 'the needs of "unit" comes through an anchor or a !reference that Keelson cannot rewrite in place',
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
  FROM_INCLUDED_FILE: [
    {
      params: { reason: "job", job: "sast", file: "ci/jobs.yml" },
      text: 'job "sast" comes from included file "ci/jobs.yml", which Keelson never writes',
    },
    {
      params: { reason: "stages", file: "ci/jobs.yml" },
      text: 'the stage list comes from included file "ci/jobs.yml", which Keelson never writes',
    },
    {
      params: { reason: "nameTaken", name: "sast", file: "ci/jobs.yml" },
      text: 'the name "sast" is already used in included file "ci/jobs.yml"',
    },
    {
      params: {
        reason: "referencedByInclude",
        job: "compile",
        referencedBy: [{ job: "sast", file: "ci/jobs.yml" }],
      },
      text: 'job "compile" is needed by sast in ci/jobs.yml, and Keelson never writes an included file',
    },
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

  SERVICE_NOT_FOUND: [{ params: { service: "n" }, text: 'service "n" is not declared' }],
  SERVICE_REFERENCED: [
    {
      params: { service: "n", jobs: ["a", "b"] },
      text: 'service "n" is integrated with a, b',
    },
  ],
  INTEGRATION_EXISTS: [
    {
      params: { job: "b", target: "n", kind: "push" },
      text: 'the push integration of "b" with "n" already exists',
    },
  ],
  INTEGRATION_NOT_FOUND: [
    {
      params: { job: "b", target: "n", kind: "push" },
      text: 'the push integration of "b" with "n" does not exist',
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

/** Calls the renderer **without** going through `render()`, hence without its fallback: an
 *  exception or a missing value reaches the test instead of being turned into a valid sentence. */
function renderDirect(code: MessageCode, params: unknown): unknown {
  const renderer = EN[code] as AnyRenderer;
  if (typeof renderer === "function") {
    return renderer(params);
  }
  const branch = renderer[(params as { reason: string }).reason];
  if (branch === undefined) {
    throw new Error(`missing branch for ${code}`);
  }
  return branch(params);
}

const rendered = (code: MessageCode, params: unknown): string => render(code, params as never);

describe("message registry", () => {
  test("every code has a message, and every message has a code", () => {
    const registered: string[] = [...MESSAGE_CODES];
    expect(registered.sort()).toEqual(Object.keys(EN).sort());
  });

  test("the set of codes is exactly that of specs/diagnostics.md", () => {
    const documented = documentedCodes();
    const registered: string[] = [...MESSAGE_CODES].sort();

    expect(documented.filter((code) => !registered.includes(code))).toEqual([]);
    expect(registered.filter((code) => !documented.includes(code))).toEqual([]);
  });

  test("every code has a fixture, and every branch its own", () => {
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

describe("English rendering", () => {
  /** The module's strong assertion: every branch of every code renders **exactly** this text, with
   *  the renderer called directly. Changing a sentence in `en.ts` turns this red, on purpose —
   *  wordings are part of the product, not an implementation detail. */
  test("every branch renders exactly its text", () => {
    for (const code of MESSAGE_CODES) {
      for (const entry of FIXTURES[code]) {
        expect({ code, text: renderDirect(code, entry.params) }).toEqual({
          code,
          text: entry.text,
        });
      }
    }
  });

  test("no rendering leaves a hole or a placeholder", () => {
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

  test("no rendering contains a French character", () => {
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

  /** Found while migrating the UI: `ErrorBanner` crashed on a `JOB_REFERENCED` whose `params` did
   *  not carry `referencedBy`. The type requires it, the wire does not guarantee it, and the
   *  exception happened while displaying another error.
   *
   *  The `INVALID_YAML` cases come from the 2026-10-22 review: it is the only renderer whose body
   *  is a bare read of `params`, so it did not throw — it returned `undefined`, which the CLI then
   *  passed to `.replace()`. The `try/catch` was not enough: `render()` must also reject what the
   *  renderer returns when it is not a sentence. */
  test("rendering never throws and always returns a sentence", () => {
    expect(rendered("JOB_REFERENCED", { job: "compile" })).toBe("unexpected server response");
    expect(rendered("NOT_FOUND", { reason: "made-up" })).toBe("unexpected server response");
    expect(rendered("NEEDS_CYCLE", {})).toBe("unexpected server response");
    expect(rendered("INVALID_YAML", {})).toBe("unexpected server response");
    expect(rendered("INVALID_YAML", { detail: "   " })).toBe("unexpected server response");
    expect(rendered("INCLUDE_UNRESOLVED", undefined)).toBe("unexpected server response");
  });

  test("the two branches of a reason code render distinct texts", () => {
    expect(rendered("INVALID_NAME", { reason: "job", name: ".tpl" })).not.toBe(
      rendered("INVALID_NAME", { reason: "stage" }),
    );
    expect(rendered("RANGE_OUT_OF_BOUNDS", { reason: "stageKey" })).not.toBe(
      rendered("RANGE_OUT_OF_BOUNDS", { reason: "needsKey" }),
    );
  });
});
