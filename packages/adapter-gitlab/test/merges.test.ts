import { describe, expect, test } from "bun:test";
import { EXTENDS_DEPTH_EXCEEDED, VALUE_CYCLE } from "@keelson/core";
import { MAX_EXTENDS_DEPTH } from "../src/defaults.ts";
import type { IncludeReader } from "../src/includes.ts";
import { GITLAB_CI_FILE, parse } from "../src/parse.ts";

function job(text: string, id: string) {
  const found = parse(text).pipeline.jobs.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`job "${id}" missing from the pipeline`);
  }
  return found;
}

const STAGES = "stages:\n  - build\n  - test\n  - deploy\n\n";

/** Every expectation below is what Ruby's Psych — the parser GitLab loads its YAML with —
 *  returns for the same text: a merge key writes its keys at its position, a later write wins. */
describe("merge keys, in Psych's order of writes", () => {
  const anchors = ".x: &x\n  stage: build\n.y: &y\n  stage: deploy\n";

  test("of two merge keys, the last one wins", () => {
    const text = `${STAGES}${anchors}j:\n  <<: *x\n  <<: *y\n  script: a\n`;
    expect(job(text, "j").stage).toEqual({
      value: "deploy",
      origin: { kind: "anchor", name: "y" },
    });
  });

  test("a merge key written after a local key overrides it", () => {
    const text = `${STAGES}${anchors}j:\n  stage: build\n  <<: *y\n  script: a\n`;
    expect(job(text, "j").stage.value).toBe("deploy");
  });

  test("a local key written after a merge key overrides it", () => {
    const text = `${STAGES}${anchors}j:\n  <<: *y\n  stage: build\n  script: a\n`;
    expect(job(text, "j").stage).toEqual({ value: "build", origin: { kind: "local" } });
  });

  test("in a merge list, the first map wins", () => {
    const text = `${STAGES}${anchors}j:\n  <<: [*x, *y]\n  script: a\n`;
    expect(job(text, "j").stage.value).toBe("build");
  });

  test("a merge key on an inline map merges it", () => {
    const text = `${STAGES}j:\n  <<: {stage: deploy}\n  script: a\n`;
    expect(job(text, "j").stage.value).toBe("deploy");
  });

  test("a merge is shallow: a local environment replaces the merged one whole", () => {
    const text = `${STAGES}.e: &e\n  environment:\n    name: a\n    url: https://a.example.org\nj:\n  <<: *e\n  environment:\n    name: b\n  script: a\n`;
    expect(job(text, "j").environment?.value).toEqual({ name: "b" });
  });

  test("a merged map's own merge keys are followed", () => {
    const text = `${STAGES}${anchors}.z: &z\n  <<: *y\nj:\n  <<: *z\n  script: a\n`;
    expect(job(text, "j").stage.value).toBe("deploy");
  });

  test("an extends carried by a merge key is applied", () => {
    const text = `${STAGES}.t:\n  stage: deploy\n.h: &h\n  extends: .t\nj:\n  <<: *h\n  script: a\n`;
    const found = job(text, "j");
    expect(found.extends).toEqual([".t"]);
    expect(found.stage).toEqual({ value: "deploy", origin: { kind: "extends", template: ".t" } });
  });

  test("inherit written through a merge key is honoured", () => {
    const text = `${STAGES}default:\n  image: ruby\n.i: &i\n  default: false\nj:\n  inherit:\n    <<: *i\n  script: a\n`;
    expect(job(text, "j").signals.image).toBeNull();
  });

  test("a job merging itself keeps its own keys", () => {
    const text = `${STAGES}j: &j\n  <<: *j\n  stage: deploy\n  script: a\n`;
    expect(job(text, "j").stage.value).toBe("deploy");
  });
});

describe("extends of a job defined in an include and in the main file", () => {
  const files: Record<string, string> = {
    [GITLAB_CI_FILE]: `include: ci/jobs.yml\n\n${STAGES}.b:\n  stage: deploy\n\nj:\n  extends: .b\n`,
    "ci/jobs.yml":
      ".a:\n  stage: build\n  environment: from-a\n\nj:\n  extends: .a\n  script: make\n",
  };
  const read: IncludeReader = {
    read: (path) => files[path] ?? null,
    candidates: () => Object.keys(files),
  };
  const parsed = parse(files[GITLAB_CI_FILE] ?? "", { file: GITLAB_CI_FILE, read });
  const found = parsed.pipeline.jobs.find((candidate) => candidate.id === "j");

  test("the main file's extends replaces the include's: a list is not merged", () => {
    expect(found?.extends).toEqual([".b"]);
  });

  test("the replaced template contributes nothing", () => {
    expect(found?.stage.value).toBe("deploy");
    expect(found?.environment).toBeNull();
  });
});

describe("self-referencing values", () => {
  function cycles(text: string) {
    return parse(text).diagnostics.filter((diagnostic) => diagnostic.code === VALUE_CYCLE);
  }

  test("an environment merging itself is read as Psych reads it", () => {
    const text = "a:\n  environment: &e {name: n, <<: *e}\n  script: x\n";
    expect(job(text, "a").environment?.value).toEqual({ name: "n" });
    expect(cycles(text)).toEqual([]);
  });

  test("a script containing its own alias is a diagnostic, not an exception", () => {
    const text = "a:\n  script: &s [make, *s]\n";
    expect(cycles(text).map((diagnostic) => diagnostic.params)).toEqual([
      { job: "a", key: "script" },
    ]);
    expect(cycles(text)[0]?.severity).toBe("error");
    expect(job(text, "a").signals.script).toEqual(["make"]);
  });

  test("two templates referencing each other's script are a diagnostic", () => {
    const text =
      ".x:\n  script: [!reference [.y, script]]\n.y:\n  script: [!reference [.x, script]]\nj:\n  extends: .x\n";
    expect(cycles(text).map((diagnostic) => diagnostic.params)).toEqual([
      { job: "j", key: "script" },
    ]);
  });

  test.each([["stage"], ["needs"], ["environment"], ["image"]])(
    "a !reference loop on %s is a diagnostic",
    (key) => {
      const text = `.x:\n  ${key}: !reference [.y, ${key}]\n.y:\n  ${key}: !reference [.x, ${key}]\nj:\n  ${key}: !reference [.x, ${key}]\n  script: a\n`;
      expect(cycles(text).map((diagnostic) => diagnostic.params)).toEqual([{ job: "j", key }]);
    },
  );

  test("a !reference to a !reference is followed", () => {
    const text = `${STAGES}.x:\n  stage: deploy\n.y:\n  stage: !reference [.x, stage]\nj:\n  stage: !reference [.y, stage]\n  script: a\n`;
    expect(job(text, "j").stage.value).toBe("deploy");
  });
});

describe("extends depth", () => {
  function chain(levels: number): string {
    const templates = Array.from(
      { length: levels },
      (_, index) =>
        `.t${index + 1}:\n${index + 1 < levels ? `  extends: .t${index + 2}\n` : "  script: a\n"}`,
    );
    return `j:\n  extends: .t1\n${templates.join("")}`;
  }

  test(`${MAX_EXTENDS_DEPTH} levels are accepted`, () => {
    const codes = parse(chain(MAX_EXTENDS_DEPTH)).diagnostics.map((entry) => entry.code);
    expect(codes).not.toContain(EXTENDS_DEPTH_EXCEEDED);
    expect(codes).not.toContain("JOB_WITHOUT_SCRIPT");
  });

  test(`${MAX_EXTENDS_DEPTH + 1} levels are refused, as GitLab does`, () => {
    const found = parse(chain(MAX_EXTENDS_DEPTH + 1)).diagnostics.filter(
      (entry) => entry.code === EXTENDS_DEPTH_EXCEEDED,
    );
    expect(found.map((entry) => [entry.severity, entry.params])).toEqual([
      ["error", { job: "j", limit: MAX_EXTENDS_DEPTH }],
    ]);
  });
});
