import { describe, expect, test } from "bun:test";
import { hashText, type Operation } from "@keelson/core";
import { apply } from "../../src/apply.ts";
import type { IncludeReader } from "../../src/includes.ts";
import { GITLAB_CI_FILE, parse } from "../../src/parse.ts";
import type { Draft } from "../support/apply.ts";

function reader(files: Record<string, string>): IncludeReader {
  return { read: (path) => files[path] ?? null, candidates: () => Object.keys(files) };
}

type Tree = Record<string, string>;

function run(files: Tree, draft: Draft) {
  const text = files[GITLAB_CI_FILE] ?? "";
  const parsed = parse(text, { file: GITLAB_CI_FILE, read: reader(files) });
  const operation = { v: 1, baseHash: hashText(text), ...draft } as Operation;
  return { parsed, result: apply(parsed.document, operation) };
}

/** Expected refusal, and **nothing written**: `apply` does not touch the disk, so the only witness
 *  is that the returned text stays the input one — checked here by the absence of `value`. */
function expectRefusal(files: Tree, draft: Draft) {
  const { result } = run(files, draft);
  if (result.ok) {
    throw new Error(`operation accepted while a refusal was expected: ${JSON.stringify(draft)}`);
  }
  expect(result.error.code).toBe("FROM_INCLUDED_FILE");
  return result.error;
}

const TREE: Tree = {
  [GITLAB_CI_FILE]: [
    "include: ci/jobs.yml",
    "",
    "stages:",
    "  - build",
    "  - test",
    "",
    "local-job:",
    "  stage: test",
    "  script:",
    "    - make check",
    "",
  ].join("\n"),
  "ci/jobs.yml": [
    "compile:",
    "  stage: build",
    "  script:",
    "    - make",
    "",
    ".base:",
    "  stage: build",
    "",
  ].join("\n"),
};

describe("every operation targeting an included job is refused", () => {
  const cases: { label: string; draft: Draft }[] = [
    { label: "removeJob", draft: { kind: "removeJob", id: "compile" } },
    { label: "renameJob", draft: { kind: "renameJob", from: "compile", to: "autre" } },
    { label: "setJobStage", draft: { kind: "setJobStage", id: "compile", stage: "test" } },
    { label: "addNeed", draft: { kind: "addNeed", id: "compile", need: { job: "local-job" } } },
    { label: "removeNeed", draft: { kind: "removeNeed", id: "compile", job: "local-job" } },
    {
      label: "setEnvironment",
      draft: { kind: "setEnvironment", id: "compile", environment: { name: "prod" } },
    },
  ];

  for (const entry of cases) {
    test(`${entry.label} returns FROM_INCLUDED_FILE and names the file`, () => {
      expect(expectRefusal(TREE, entry.draft).params).toEqual({
        reason: "job",
        job: "compile",
        file: "ci/jobs.yml",
      });
    });
  }

  /** The distinction that matters: an included job **overridden** in the main file belongs to the
   *  main file, so it stays editable. That is GitLab's merge order, and it is also what a user
   *  expects of the file in front of them. */
  test("a job included then overridden in the main file stays editable", () => {
    const overridden: Tree = {
      ...TREE,
      [GITLAB_CI_FILE]: `${TREE[GITLAB_CI_FILE]}\ncompile:\n  stage: test\n`,
    };
    const { result } = run(overridden, { kind: "setJobStage", id: "compile", stage: "build" });
    expect(result.ok).toBe(true);
  });

  /** The promise the origin badge makes on screen: on a job of the main file, changing a value
   *  coming from an include writes an override **in that job**. Without this test, the help text
   *  would assert a behaviour no test upholds. */
  test("changing a value coming from an include writes the override in the main file", () => {
    const overridden: Tree = {
      ...TREE,
      [GITLAB_CI_FILE]: `${TREE[GITLAB_CI_FILE]}\ncompile:\n  script:\n    - make autre\n`,
    };
    const before = parse(overridden[GITLAB_CI_FILE] ?? "", {
      file: GITLAB_CI_FILE,
      read: reader(overridden),
    });
    expect(before.pipeline.jobs.find((job) => job.id === "compile")?.stage.origin).toEqual({
      kind: "include",
      file: "ci/jobs.yml",
    });

    const { result } = run(overridden, { kind: "setJobStage", id: "compile", stage: "test" });
    if (!result.ok) {
      throw new Error(`operation refused: ${result.error.code}`);
    }

    expect(result.value.text).toContain("compile:\n  stage: test\n");
    expect(result.value.included["ci/jobs.yml"]).toBe(overridden["ci/jobs.yml"]);
    expect(result.value.pipeline.jobs.find((job) => job.id === "compile")?.stage).toEqual({
      value: "test",
      origin: { kind: "local" },
    });
  });

  test("a job that exists nowhere stays JOB_NOT_FOUND, not FROM_INCLUDED_FILE", () => {
    const { result } = run(TREE, { kind: "removeJob", id: "fantome" });
    expect(result.ok ? null : result.error.code).toBe("JOB_NOT_FOUND");
  });
});

describe("names already taken in an included file", () => {
  test("addJob on a name coming from an include is refused rather than overridden", () => {
    expect(
      expectRefusal(TREE, {
        kind: "addJob",
        job: { id: "compile", stage: "test", script: ["make"] },
      }).params,
    ).toEqual({ reason: "nameTaken", name: "compile", file: "ci/jobs.yml" });
  });

  /** A template name is refused **before** reaching the include check: `.base` is not a legal job
   *  name in GitLab, wherever the key lives. The test is here to pin the order of refusals, not
   *  to cover includes. */
  test("a template name stays INVALID_NAME, not an include conflict", () => {
    const { result } = run(TREE, {
      kind: "addJob",
      job: { id: ".base", stage: "test", script: ["make"] },
    });
    expect(result.ok ? null : result.error.code).toBe("INVALID_NAME");
  });

  test("renameJob to a name coming from an include is refused", () => {
    expect(
      expectRefusal(TREE, { kind: "renameJob", from: "local-job", to: "compile" }).params,
    ).toEqual({ reason: "nameTaken", name: "compile", file: "ci/jobs.yml" });
  });

  test("addJob on a name free everywhere passes", () => {
    const { result } = run(TREE, {
      kind: "addJob",
      job: { id: "neuf", stage: "test", script: ["make"] },
    });
    expect(result.ok).toBe(true);
  });
});

describe("renameJob and the referrers of an included file", () => {
  const referencing: Tree = {
    [GITLAB_CI_FILE]: [
      "include: ci/jobs.yml",
      "",
      "stages:",
      "  - build",
      "  - test",
      "",
      "compile:",
      "  stage: build",
      "  script:",
      "    - make",
      "",
    ].join("\n"),
    "ci/jobs.yml": [
      "sast:",
      "  stage: test",
      "  needs:",
      "    - compile",
      "  script:",
      "    - make scan",
      "",
    ].join("\n"),
  };

  test("the rename is refused and names each referrer with its file", () => {
    expect(
      expectRefusal(referencing, { kind: "renameJob", from: "compile", to: "build" }).params,
    ).toEqual({
      reason: "referencedByInclude",
      job: "compile",
      referencedBy: [{ job: "sast", file: "ci/jobs.yml" }],
    });
  });

  test("without an included referrer, the rename passes", () => {
    const alone: Tree = {
      ...referencing,
      "ci/jobs.yml": "autre:\n  stage: test\n  script:\n    - x\n",
    };
    const { result } = run(alone, { kind: "renameJob", from: "compile", to: "build" });
    expect(result.ok).toBe(true);
  });
});

describe("stage list coming from an included file", () => {
  const stagesTree: Tree = {
    [GITLAB_CI_FILE]: [
      "include: ci/stages.yml",
      "",
      "travail:",
      "  stage: livrer",
      "  script:",
      "    - make",
      "",
    ].join("\n"),
    "ci/stages.yml": ["stages:", "  - preparer", "  - livrer", ""].join("\n"),
  };

  /** The defect this refusal prevents is silent: `stagesSeq` finds no list in the main file, so
   *  `planAddStage` **materialised** one from GitLab's default stages. The include's list vanished
   *  from the screen without any error saying so. */
  test("addStage is refused and names the file of the list", () => {
    expect(expectRefusal(stagesTree, { kind: "addStage", name: "verifier" }).params).toEqual({
      reason: "stages",
      file: "ci/stages.yml",
    });
  });

  test("moveStage is refused too", () => {
    expect(
      expectRefusal(stagesTree, { kind: "moveStage", name: "livrer", toIndex: 0 }).params,
    ).toEqual({ reason: "stages", file: "ci/stages.yml" });
  });

  test("adding a job to a stage coming from an include is still allowed", () => {
    const { result } = run(stagesTree, {
      kind: "addJob",
      job: { id: "neuf", stage: "preparer", script: ["make"] },
    });
    expect(result.ok).toBe(true);
  });

  test("with a list in the main file, addStage passes", () => {
    const local: Tree = {
      ...stagesTree,
      [GITLAB_CI_FILE]: `stages:\n  - livrer\n\n${stagesTree[GITLAB_CI_FILE]}`,
    };
    const { result } = run(local, { kind: "addStage", name: "verifier" });
    expect(result.ok).toBe(true);
  });
});

describe("apply lets nothing out of the main file", () => {
  /** What this block measures, exactly: `apply` is a **pure** function — it does not touch the
   *  disk — so re-reading an included file after the call would be a tautology. That was the
   *  first version of these tests, and the independent review of 2026-10-23 proved it inert by
   *  neutralising every `FROM_INCLUDED_FILE` refusal: both tests stayed green.
   *
   *  What is measurable here is that the result does not claim to have changed an included file:
   *  `included` must come back identical, and every touched range must fall within the main
   *  file's text. The guarantee on the **bytes on disk** is measured where a write takes place,
   *  that is in `packages/server/test/includes.test.ts`. */
  test("included texts come back identical after an accepted operation", () => {
    const { parsed, result } = run(TREE, {
      kind: "addJob",
      job: { id: "neuf", stage: "test", script: ["make"] },
    });
    if (!result.ok) {
      throw new Error(`operation refused: ${result.error.code}`);
    }

    expect(result.value.included).toEqual(parsed.included);
    expect(result.value.included["ci/jobs.yml"]).toBe(TREE["ci/jobs.yml"]);
  });

  test("every touched range falls within the main file's text", () => {
    const { result } = run(TREE, {
      kind: "addJob",
      job: { id: "neuf", stage: "test", script: ["make"] },
    });
    if (!result.ok) {
      throw new Error("operation refused");
    }

    for (const range of result.value.touched) {
      expect(range.start).toBeGreaterThanOrEqual(0);
      expect(range.end).toBeLessThanOrEqual(result.value.text.length);
    }
  });

  test("the pipeline returned after the operation keeps the jobs of included files", () => {
    const { result } = run(TREE, {
      kind: "addJob",
      job: { id: "neuf", stage: "test", script: ["make"] },
    });
    if (!result.ok) {
      throw new Error("operation refused");
    }
    // Without the reader carried by the document, `apply` would re-read the text without its
    // includes and `compile` would disappear from the response.
    expect(result.value.pipeline.jobs.map((job) => job.id).sort()).toEqual([
      "compile",
      "local-job",
      "neuf",
    ]);
  });
});

describe("setJobStage on a !reference value", () => {
  /** The badge promises an explicit override. The operation wrote `stage: !reference test`: the
   *  tag stayed on a scalar, a form nobody typed and that GitLab rejects. */
  const REFERENCED = [
    "stages:",
    "  - build",
    "  - test",
    "",
    ".base:",
    "  stage: build",
    "",
    "compile:",
    "  stage: !reference [.base, stage]",
    "  script:",
    "    - make",
    "",
  ].join("\n");

  test("the reference is replaced entirely, and the inverse restores it", () => {
    const { result } = run(
      { [GITLAB_CI_FILE]: REFERENCED },
      { kind: "setJobStage", id: "compile", stage: "test" },
    );
    if (!result.ok) {
      throw new Error(`operation refused: ${result.error.code}`);
    }

    expect(result.value.text).toBe(
      REFERENCED.replace("stage: !reference [.base, stage]", "stage: test"),
    );
    const back = apply(result.value.document, result.value.inverse);
    expect(back.ok ? back.value.text : null).toBe(REFERENCED);
  });

  const HEAD = "stages:\n  - build\n  - test\n\n.base:\n  stage: build\n\ncompile:\n";
  const BLOCK = "  stage: !reference\n    - .base\n    - stage\n";

  function retarget(text: string): string {
    const { result } = run(
      { [GITLAB_CI_FILE]: text },
      { kind: "setJobStage", id: "compile", stage: "test" },
    );
    if (!result.ok) {
      throw new Error(`operation refused: ${result.error.code}`);
    }
    const back = apply(result.value.document, result.value.inverse);
    expect(back.ok ? back.value.text : null).toBe(text);
    return result.value.text;
  }

  /** The end of a block sequence takes its line break and what follows with it: replacing up to
   *  there glued the next line on, and the gesture was refused or ate the end of the file. */
  test("a block reference is replaced, the next line stays in place", () => {
    expect(retarget(`${HEAD}${BLOCK}  script:\n    - make\n`)).toBe(
      `${HEAD}  stage: test\n  script:\n    - make\n`,
    );
  });

  test("at the end of the file, the final line break stays", () => {
    expect(retarget(`${HEAD}  script:\n    - make\n${BLOCK}`)).toBe(
      `${HEAD}  script:\n    - make\n  stage: test\n`,
    );
  });

  test("the comment and the empty line that follow stay", () => {
    expect(retarget(`${HEAD}${BLOCK}  # garde\n\n  script:\n    - make\n`)).toBe(
      `${HEAD}  stage: test\n  # garde\n\n  script:\n    - make\n`,
    );
  });

  test("the last item's comment stays, in CRLF too", () => {
    const crlf = (text: string) => text.replaceAll("\n", "\r\n");
    const block = "  stage: !reference\n    - .base\n    - stage # note\n";
    expect(retarget(crlf(`${HEAD}${block}  script:\n    - make\n`))).toBe(
      crlf(`${HEAD}  stage: test # note\n  script:\n    - make\n`),
    );
  });
});
