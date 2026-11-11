import { describe, expect, test } from "bun:test";
import type { IncludeReader } from "../src/includes.ts";
import { GITLAB_CI_FILE, parse } from "../src/parse.ts";

function signals(text: string, files: Record<string, string> = {}, id = "job") {
  const read: IncludeReader = {
    read: (p) => files[p] ?? null,
    candidates: () => Object.keys(files),
  };
  const parsed = parse(text, { file: GITLAB_CI_FILE, read });
  return parsed.pipeline.jobs.find((job) => job.id === id)?.signals;
}

describe("signals of a job", () => {
  test("image and script written in the job", () => {
    expect(signals("job:\n  image: aquasec/trivy:0.1\n  script:\n    - trivy fs .\n")).toEqual({
      image: "aquasec/trivy:0.1",
      script: ["trivy fs ."],
    });
  });

  test("image in object form", () => {
    expect(signals("job:\n  image:\n    name: x/y\n  script: a\n")?.image).toBe("x/y");
  });

  test("the three sections, in execution order, and a scalar script", () => {
    expect(
      signals("job:\n  after_script:\n    - c\n  script: b\n  before_script:\n    - a\n")?.script,
    ).toEqual(["a", "b", "c"]);
  });

  test("inherited from an extends written in an include", () => {
    expect(
      signals("include: ci/t.yml\n\njob:\n  extends: .t\n", {
        "ci/t.yml": ".t:\n  image: semgrep/semgrep\n  script:\n    - semgrep ci\n",
      }),
    ).toEqual({ image: "semgrep/semgrep", script: ["semgrep ci"] });
  });

  test("default applies under the job, and the job overrides it", () => {
    const text = "default:\n  image: a/b\n  before_script:\n    - x\n\njob:\n  script: y\n";
    expect(signals(text)).toEqual({ image: "a/b", script: ["x", "y"] });
    expect(signals(`${text}  image: c/d\n`)?.image).toBe("c/d");
  });

  test("a !reference in a script list is expanded, and nested lists too", () => {
    expect(
      signals(
        ".s:\n  script:\n    - un\n    - - deux\n\njob:\n  script:\n    - !reference [.s, script]\n    - trois\n",
      )?.script,
    ).toEqual(["un", "deux", "trois"]);
  });

  test("a job with neither image nor script returns empty, not an error", () => {
    expect(signals("job:\n  stage: test\n")).toEqual({ image: null, script: [] });
  });
});

describe("the effective values of D1", () => {
  test("global image and before_script, deprecated but valid", () => {
    const text = "image: aquasec/trivy\nbefore_script:\n  - a\n\njob:\n  script: b\n";
    expect(signals(text)).toEqual({ image: "aquasec/trivy", script: ["a", "b"] });
  });

  test("a global script does not exist: only the job's counts", () => {
    expect(signals("script:\n  - global\n\njob:\n  stage: test\n")?.script).toEqual([]);
  });

  test("inherit: default: false cuts off default and the global keys", () => {
    const text =
      "default:\n  image: a/b\n  before_script:\n    - x\n\njob:\n  inherit:\n    default: false\n  script: y\n";
    expect(signals(text)).toEqual({ image: null, script: ["y"] });
  });

  test("inherit: default: [list] keeps only what it names", () => {
    const text =
      "default:\n  image: a/b\n  before_script:\n    - x\n\njob:\n  inherit:\n    default: [before_script]\n  script: y\n";
    expect(signals(text)).toEqual({ image: null, script: ["x", "y"] });
  });

  test("default through an alias and through a merge key", () => {
    const base = ".d: &d\n  image: a/b\n\n";
    expect(signals(`${base}default: *d\n\njob:\n  script: y\n`)?.image).toBe("a/b");
    expect(signals(`${base}default:\n  <<: *d\n\njob:\n  script: y\n`)?.image).toBe("a/b");
  });

  test("the image name through an alias, !reference or merge key", () => {
    const cases = [
      "x: &i a/b\n\njob:\n  image:\n    name: *i\n  script: y\n",
      ".t:\n  name: a/b\n\njob:\n  image:\n    name: !reference [.t, name]\n  script: y\n",
      ".t: &t\n  name: a/b\n\njob:\n  image:\n    <<: *t\n  script: y\n",
    ];
    expect(cases.map((text) => signals(text)?.image)).toEqual(["a/b", "a/b", "a/b"]);
  });
});

describe("extends merging and jobs without execution", () => {
  test("inherit merges key by key: the template's default: false survives", () => {
    const text =
      "default:\n  image: d\n\n.t:\n  inherit:\n    default: false\n\njob:\n  extends: .t\n  inherit:\n    variables: false\n  script: a\n";
    expect(signals(text)?.image).toBeNull();
  });

  test("<< is not extends: the job's inherit replaces the anchor's", () => {
    const text =
      "default:\n  image: d\n\n.t: &t\n  inherit:\n    default: false\n  script: a\n\njob:\n  <<: *t\n  inherit:\n    variables: false\n";
    expect(signals(text)?.image).toBe("d");
  });

  test("an inherit coming only from an anchor applies", () => {
    const text =
      "default:\n  image: d\n\n.t: &t\n  inherit:\n    default: false\n  script: a\n\njob:\n  <<: *t\n";
    expect(signals(text)?.image).toBeNull();
  });

  test("an inherit in a template's anchor merges across extends", () => {
    const text =
      "default:\n  image: d\n\n.a: &a\n  inherit:\n    default: false\n\n.t:\n  <<: *a\n\njob:\n  extends: .t\n  inherit:\n    variables: false\n  script: a\n";
    expect(signals(text)?.image).toBeNull();
  });

  test("an object image merges: the name comes from the template, the entrypoint from the job", () => {
    const text =
      ".t:\n  image:\n    name: aquasec/trivy\n\njob:\n  extends: .t\n  image:\n    entrypoint: ['']\n  script: a\n";
    expect(signals(text)?.image).toBe("aquasec/trivy");
  });

  test("a scalar in the job replaces the template's object", () => {
    const text = ".t:\n  image:\n    name: a/b\n\njob:\n  extends: .t\n  image: c/d\n  script: a\n";
    expect(signals(text)?.image).toBe("c/d");
  });

  test("a trigger job runs nothing: default's image and before_script do not apply to it", () => {
    const text =
      "default:\n  image: aquasec/trivy\n  before_script:\n    - trivy fs .\n\njob:\n  trigger: child.yml\n";
    expect(signals(text)).toEqual({ image: null, script: [] });
  });

  test.each([
    ["<<: *a", "job: &a\n  script: a\n  <<: *a\n"],
    ["<<: [*a]", "job: &a\n  script: a\n  <<: [*a]\n"],
    ["template", ".t: &t\n  script: a\n  <<: *t\n\njob:\n  extends: .t\n"],
  ])("a map merged onto itself does not crash the parse: %s", (_label, text) => {
    expect(signals(`default:\n  image: d\n\n${text}`)?.image).toBe("d");
  });

  test("diamond anchors are walked in linear time", () => {
    const levels = Array.from({ length: 20 }, (_, index) =>
      index === 0
        ? ".x0: &x0\n  a: 1\n"
        : `.x${index}: &x${index}\n  <<: [*x${index - 1}, *x${index - 1}]\n`,
    );
    const started = performance.now();
    signals(`${levels.join("")}job:\n  <<: *x19\n  script: a\n`);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
