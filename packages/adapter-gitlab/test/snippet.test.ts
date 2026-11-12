import { describe, expect, test } from "bun:test";
import { coverage, loadCatalog } from "@keelson/catalog";
import { hashText, type Operation, type SpliceOperation } from "@keelson/core";
import { apply } from "../src/apply.ts";
import type { IncludeReader } from "../src/includes.ts";
import { GITLAB_CI_FILE, parse } from "../src/parse.ts";

const BASE = "stages:\n  - build\n  - test\n\ncompile:\n  stage: build\n  script:\n    - make\n";
const SNIPPET =
  'trivy:\n  stage: test\n  image:\n    name: aquasec/trivy:latest\n    entrypoint: [""]\n  script:\n    - trivy fs .\n';

type Draft = Record<string, unknown> & { kind: string };

function run(text: string, draft: Draft) {
  return apply(parse(text).document, { v: 1, baseHash: hashText(text), ...draft } as Operation);
}

function written(text: string, draft: Draft): string {
  const result = run(text, draft);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value.text;
}

const add = { kind: "addSnippet", id: "trivy", stage: "test", snippet: SNIPPET };

describe("addSnippet", () => {
  test("copies the snippet as is at the end of the file", () => {
    expect(written(BASE, add)).toBe(`${BASE}\n${SNIPPET}`);
  });

  test("the key and the stage are replaced, nothing else", () => {
    const text = written(BASE, { ...add, id: "scan-fs", stage: "build" });
    expect(text).toContain("scan-fs:\n  stage: build\n  image:\n    name: aquasec/trivy:latest\n");
    expect(text).not.toContain("trivy:\n");
  });

  test("a snippet without a stage gets one", () => {
    const text = written(BASE, { ...add, snippet: "x:\n  script:\n    - a\n" });
    const job = parse(text).pipeline.jobs.find((entry) => entry.id === "trivy");
    expect(job?.stage.value).toBe("test");
  });

  test("the file's line ending applies to the snippet", () => {
    const crlf = BASE.replaceAll("\n", "\r\n");
    expect(written(crlf, add)).not.toMatch(/[^\r]\n/);
  });

  test("a booby-trapped job name stays a key", () => {
    const text = written(BASE, { ...add, id: "scan: fs" });
    expect(parse(text).pipeline.jobs.map((job) => job.id)).toContain("scan: fs");
  });

  test.each([
    ["two jobs", "a:\n  script: x\nb:\n  script: y\n"],
    ["a list", "- a\n"],
    ["a scalar", "bonjour\n"],
    ["broken YAML", "a: [\n"],
    ["an anchor", "a: &x\n  script: y\n"],
    ["an empty job", "a:\n"],
    ["a top-level key", "stages:\n  - a\n"],
    ["a flow job", "a: {script: y}\n"],
  ])("%s is refused", (_label, snippet) => {
    const result = run(BASE, { ...add, snippet });
    expect(result.ok ? null : result.error).toMatchObject({
      code: "INVALID_OPERATION",
      params: { reason: "invalidSnippet" },
    });
  });

  test.each([
    ["an indented key", "  x:\n    stage: test\n    script:\n      - a\n"],
    ["an indented leading comment", "    # note\nx:\n  script:\n    - a\n"],
    ["a commented empty stage", "x:\n  stage: # c\n  script:\n    - a\n"],
    ["a tagged empty stage", "x:\n  stage: !!str\n  script:\n    - a\n"],
    ["a stage without a value", "x:\n  stage:\n  script:\n    - a\n"],
  ])("%s is refused", (_label, snippet) => {
    expect(run(BASE, { ...add, snippet })).toMatchObject({
      error: { params: { reason: "invalidSnippet" } },
    });
  });

  test("a leading comment at column zero is copied", () => {
    expect(written(BASE, { ...add, snippet: `# scan\n${SNIPPET}` })).toContain("# scan\ntrivy:\n");
  });

  test("the name and stage refusals are addJob's", () => {
    expect(run(BASE, { ...add, id: "compile" })).toMatchObject({
      error: { code: "NAME_CONFLICT" },
    });
    expect(run(BASE, { ...add, id: ".x" })).toMatchObject({ error: { code: "INVALID_NAME" } });
    expect(run(BASE, { ...add, stage: "deploy2" })).toMatchObject({
      error: { code: "STAGE_NOT_FOUND" },
    });
  });

  test("a name taken in an included file is refused", () => {
    const files: Record<string, string> = { "ci/a.yml": "trivy:\n  script: x\n" };
    const read: IncludeReader = {
      read: (p) => files[p] ?? null,
      candidates: () => Object.keys(files),
    };
    const text = `include: /ci/a.yml\n${BASE}`;
    const document = parse(text, { file: GITLAB_CI_FILE, read }).document;
    const result = apply(document, { v: 1, baseHash: hashText(text), ...add } as Operation);
    expect(result.ok ? null : result.error.code).toBe("FROM_INCLUDED_FILE");
  });

  test("every GitLab snippet in the catalogue inserts and covers its layers", () => {
    const { tools } = loadCatalog();
    const failures = tools.flatMap((tool) => {
      const snippet = tool.snippets.gitlab;
      if (snippet === null) {
        return [];
      }
      const result = run(BASE, { kind: "addSnippet", id: "added", stage: "test", snippet });
      if (!result.ok) {
        return [`${tool.id}: ${result.error.code}`];
      }
      const covered = coverage(result.value.pipeline, tools).jobs.find(
        (entry) => entry.job === "added",
      );
      return tool.layers.every((layer) => covered?.layers.includes(layer))
        ? []
        : [`${tool.id}: couches ${covered?.layers.join(",")}`];
    });
    expect(failures).toEqual([]);
  });
});

describe("composite", () => {
  const steps = [
    { kind: "addStage", name: "security" },
    { kind: "addSnippet", id: "trivy", stage: "security", snippet: SNIPPET },
  ];

  test("the stage and the job arrive together", () => {
    const text = written(BASE, { kind: "composite", steps });
    const { pipeline } = parse(text);
    expect(pipeline.stages.map((stage) => stage.name)).toContain("security");
    expect(pipeline.jobs.find((job) => job.id === "trivy")?.stage.value).toBe("security");
  });

  test("a single inverse restores the original text, byte for byte", () => {
    const result = run(BASE, { kind: "composite", steps });
    if (!result.ok) {
      throw new Error("refused");
    }
    const { document } = parse(result.value.text);
    const back = apply(document, result.value.inverse as SpliceOperation);
    expect(back.ok && back.value.text).toBe(BASE);
  });

  test("a single range touched, from the first to the last changed byte", () => {
    const result = run(BASE, { kind: "composite", steps });
    expect(result.ok && result.value.touched).toHaveLength(1);
    const range = result.ok ? result.value.touched[0] : undefined;
    expect(result.ok && result.value.text.slice(0, range?.start)).toBe(BASE.slice(0, range?.start));
  });

  test("touched never splits a surrogate pair, and the inverse stays exact", () => {
    const text = "stages:\n  - \u{1F600}\n\ncompile:\n  stage: \u{1F600}\n  script:\n    - make\n";
    const result = run(text, {
      kind: "composite",
      steps: [
        { kind: "addStage", name: "\u{1F601}", index: 0 },
        { ...steps[1], stage: "\u{1F601}" },
      ],
    });
    if (!result.ok) {
      throw new Error("refused");
    }
    const range = result.value.touched[0];
    const isLow = (code: number | undefined) =>
      code !== undefined && code >= 0xdc00 && code <= 0xdfff;
    expect(isLow(result.value.text.charCodeAt(range?.start ?? 0))).toBe(false);
    expect(isLow(result.value.text.charCodeAt(range?.end ?? 0))).toBe(false);
    const back = apply(parse(result.value.text).document, result.value.inverse as SpliceOperation);
    expect(back.ok && back.value.text).toBe(text);
  });

  test("a refused step refuses everything", () => {
    const result = run(BASE, {
      kind: "composite",
      steps: [
        { kind: "addStage", name: "security" },
        { ...steps[1], id: "compile" },
      ],
    });
    expect(result.ok ? null : result.error.code).toBe("NAME_CONFLICT");
  });

  test("a composite contains neither a splice nor another composite", () => {
    const hash = hashText(BASE);
    for (const step of [
      { kind: "splice", start: 0, end: 0, text: "" },
      { kind: "composite", steps: [] },
      { kind: "removeJob", id: "compile" },
    ]) {
      const result = apply(parse(BASE).document, {
        v: 1,
        baseHash: hash,
        kind: "composite",
        steps: [step],
      } as Operation);
      expect(result.ok ? null : result.error.code).toBe("INVALID_OPERATION");
    }
  });

  test("an anchor on the last stage is not copied", () => {
    const text = "stages:\n  - build\n  - &t test\n\na:\n  stage: *t\n  script: x\n";
    const after = parse(written(text, { kind: "addStage", name: "scan" }));
    expect(after.pipeline.jobs[0]?.stage.value).toBe("test");
  });

  test.each([["- # c\n    test"], ["- &t\n    test"]])(
    "an item on a continuation line (%j) is not extended",
    (item) => {
      const text = `stages:\n  - build\n  ${item}\n\na:\n  stage: test\n  script: x\n`;
      const after = parse(written(text, { kind: "addStage", name: "scan" }));
      expect(after.pipeline.stages.map((stage) => stage.name)).toEqual(
        expect.arrayContaining(["test", "scan"]),
      );
    },
  );

  test("an empty composite is refused", () => {
    expect(run(BASE, { kind: "composite", steps: [] }).ok).toBe(false);
  });
});

describe("cross-project needs", () => {
  const INCLUDED =
    ".base:\n  needs:\n    - a\n    - project: g/p\n      job: j\n      ref: main\n      artifacts: true\n";
  const MAIN = `a:\n  stage: test\n  script: x\n\nc:\n  stage: test\n  script: x\n\njob:\n  extends: .base\n  stage: test\n  script: x\n\n${INCLUDED}`;

  test("overriding inherited needs that carry some is refused", () => {
    for (const draft of [
      { kind: "removeNeed", id: "job", job: "a" },
      { kind: "addNeed", id: "job", need: { job: "c" } },
    ]) {
      expect(run(MAIN, draft)).toMatchObject({
        error: { code: "INVALID_OPERATION", params: { reason: "sharedValue", key: "needs" } },
      });
    }
  });

  test("removing the last modelled need of a local list does not remove the key", () => {
    const text =
      "a:\n  stage: test\n  script: x\n\njob:\n  stage: test\n  script: x\n  needs:\n    - a\n    - project: g/p\n      job: j\n      ref: main\n      artifacts: true\n";
    expect(run(text, { kind: "removeNeed", id: "job", job: "a" }).ok).toBe(false);
  });

  test("a cross-project item behind an anchor is seen too", () => {
    const anchor = ".p: &p\n  project: g/p\n  job: j\n  ref: main\n  artifacts: true\n\n";
    const jobs = "a:\n  stage: test\n  script: x\n\njob:\n  stage: test\n  script: x\n  needs:\n";
    for (const item of ["    - *p\n", "    - <<: *p\n"]) {
      const text = `${anchor}${jobs}    - a\n${item}`;
      expect(run(text, { kind: "removeNeed", id: "job", job: "a" }).ok).toBe(false);
    }
  });

  test.each([
    ["!reference in the list", "    - a\n    - !reference [.n, needs]\n"],
    ["nested list", "    - a\n    - - project: g/p\n        job: j\n        ref: main\n"],
  ])("a cross-project item in %s is seen too", (_label, items) => {
    const text = `.n:\n  needs:\n    - project: g/p\n      job: j\n      ref: main\n\n.tpl:\n  needs:\n${items}\na:\n  stage: test\n  script: x\n\nc:\n  stage: test\n  script: x\n\njob:\n  extends: .tpl\n  stage: test\n  script: x\n`;
    expect(run(text, { kind: "addNeed", id: "job", need: { job: "c" } }).ok).toBe(false);
  });

  test("an ordinary nested item is not lost either", () => {
    const text = `.n:\n  needs:\n    - b\n\n.t:\n  needs:\n    - a\n    - !reference [.n, needs]\n\na:\n  stage: test\n  script: x\n\nb:\n  stage: test\n  script: x\n\nc:\n  stage: test\n  script: x\n\njob:\n  extends: .t\n  stage: test\n  script: x\n`;
    expect(run(text, { kind: "addNeed", id: "job", need: { job: "c" } }).ok).toBe(false);
  });

  test("wide references do not blow up the analysis", () => {
    const refs = "    - !reference [.n, needs]\n".repeat(30);
    const started = performance.now();
    parse(`.n:\n  needs:\n${refs}\na:\n  extends: .n\n  script: x\n`);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test.each([
    ["scalar alias", "    - a\n    - *b\n"],
    ["map with alias", "    - a\n    - job: *b\n"],
    ["unmodelled key", "    - job: a\n      parallel:\n        matrix:\n          - X: 1\n"],
    ["optional as alias", "    - job: a\n      optional: *o\n"],
  ])("overriding an inherited list with %s is refused", (_label, items) => {
    const text = `.v:\n  x: &b a\n  y: &o true\n\n.t:\n  needs:\n${items}\na:\n  stage: test\n  script: x\n\nc:\n  stage: test\n  script: x\n\njob:\n  extends: .t\n  stage: test\n  script: x\n`;
    expect(run(text, { kind: "addNeed", id: "job", need: { job: "c" } })).toMatchObject({
      error: { code: "INVALID_OPERATION" },
    });
  });

  test("removing the last local need does not bring the inherited one back", () => {
    const text =
      ".t:\n  needs:\n    - b\n\na:\n  stage: test\n  script: x\n\nb:\n  stage: test\n  script: x\n\njob:\n  extends: .t\n  stage: test\n  script: x\n  needs:\n    - a\n";
    const result = run(text, { kind: "removeNeed", id: "job", job: "a" });
    if (result.ok) {
      const job = parse(result.value.text).pipeline.jobs.find((entry) => entry.id === "job");
      expect(job?.needs?.value ?? []).toEqual([]);
    }
  });

  test("removing an item carrying a used anchor leaves no dangling alias", () => {
    const text =
      "a:\n  stage: test\n  script: x\n\nb:\n  stage: test\n  script: x\n\njob:\n  stage: test\n  script: x\n  needs:\n    - &k a\n    - b\n\nz:\n  stage: test\n  script: x\n  needs:\n    - *k\n";
    expect(run(text, { kind: "removeNeed", id: "job", job: "a" }).ok).toBe(false);
  });

  test("a long chain of anchors does not slow the analysis down", () => {
    const links = Array.from({ length: 400 }, (_, index) =>
      index === 0
        ? ".m0: &m0\n  x: 1\n"
        : `.m${index}: &m${index}\n  <<: [*m${index - 1}, *m${index - 1}]\n`,
    ).join("");
    const started = performance.now();
    parse(`${links}.t:\n  needs:\n    - *m399\n\njob:\n  extends: .t\n  script: x\n`);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  test("a flow list does not lose a need's options", () => {
    const text =
      "a:\n  stage: test\n  script: x\n\nc:\n  stage: test\n  script: x\n\njob:\n  stage: test\n  script: x\n  needs: [a]\n";
    const result = run(text, { kind: "addNeed", id: "job", need: { job: "c", optional: true } });
    if (result.ok) {
      const job = parse(result.value.text).pipeline.jobs.find((entry) => entry.id === "job");
      expect(job?.needs?.value.find((need) => need.job === "c")?.optional).toBe(true);
    }
  });

  test.each([
    ["artifacts: no", "    - job: a\n      artifacts: no\n"],
    ["optional: yes", "    - job: a\n      optional: yes\n"],
    ["numeric job", "    - job: 123\n"],
    ["no job", "    - optional: true\n"],
  ])("an item with a dubious re-read (%s) is not rewritten", (_label, items) => {
    const text = `.t:\n  needs:\n${items}\na:\n  stage: test\n  script: x\n\nc:\n  stage: test\n  script: x\n\njob:\n  extends: .t\n  stage: test\n  script: x\n`;
    expect(run(text, { kind: "addNeed", id: "job", need: { job: "c" } }).ok).toBe(false);
  });

  test("adding a need to a file without a final line ending", () => {
    const text =
      "a:\n  stage: test\n  script: x\n\nc:\n  stage: test\n  script: x\n\njob:\n  stage: test\n  script: x\n  needs:\n    - a";
    const after = parse(written(text, { kind: "addNeed", id: "job", need: { job: "c" } }));
    const job = after.pipeline.jobs.find((entry) => entry.id === "job");
    expect(job?.needs?.value.map((need) => need.job)).toEqual(["a", "c"]);
  });

  test("a CRLF file ending with a bare line feed does not get an empty line", () => {
    const text =
      "a:\r\n  stage: test\r\n  script: x\r\n\r\nc:\r\n  stage: test\r\n  script: x\r\n\r\njob:\r\n  stage: test\r\n  script: x\r\n  needs:\r\n    - a\n";
    expect(written(text, { kind: "addNeed", id: "job", need: { job: "c" } })).toEndWith(
      "    - a\n    - c\r\n",
    );
  });

  test("many aliases stay linear when writing", () => {
    const aliases = Array.from({ length: 3000 }, () => "    - *x\n").join("");
    const started = performance.now();
    run(`.v:\n  y: &x a\n\nz:\n  stage: test\n  script:\n${aliases}`, {
      kind: "splice",
      start: 0,
      end: 0,
      text: "",
    });
    expect(performance.now() - started).toBeLessThan(4000);
  });

  test("a local list extends without losing the item", () => {
    const text =
      "a:\n  stage: test\n  script: x\n\nc:\n  stage: test\n  script: x\n\njob:\n  stage: test\n  script: x\n  needs:\n    - a\n    - project: g/p\n      job: j\n      ref: main\n      artifacts: true\n";
    expect(written(text, { kind: "addNeed", id: "job", need: { job: "c" } })).toContain(
      "project: g/p",
    );
  });
});
