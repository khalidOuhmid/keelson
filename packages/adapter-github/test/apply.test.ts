import { describe, expect, test } from "bun:test";
import { hashText, type Operation, type SpliceOperation } from "@keelson/core";
import { apply, parse } from "../src/index.ts";

const FILE = ".github/workflows/ci.yml";

const BASE = `# the CI
name: CI
on: [push]

jobs:
  # compiles everything
  build:
    runs-on: ubuntu-latest # fast
    steps:
      - run: make

  test:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: make check

  deploy:
    needs: [build, test]
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy
`;

type Draft = Record<string, unknown> & { kind: string };

function run(text: string, draft: Draft) {
  return apply(parse(text, { file: FILE }).document, {
    v: 1,
    baseHash: hashText(text),
    ...draft,
  } as Operation);
}

function written(text: string, draft: Draft): string {
  const result = run(text, draft);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value.text;
}

const jobOf = (text: string, id: string) =>
  parse(text, { file: FILE }).pipeline.jobs.find((job) => job.id === id);

const needsOf = (text: string, id: string) => jobOf(text, id)?.needs?.value.map((n) => n.job);

const newJob = { id: "lint", stage: "", script: ["make lint"] };

describe("addJob", () => {
  test("at the end of jobs, at the detected indentation, the rest intact", () => {
    const text = written(BASE, { kind: "addJob", job: newJob });
    expect(text).toContain(
      "      - run: ./deploy\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: make lint\n",
    );
    expect(text.startsWith(BASE)).toBe(true);
  });

  test("with needs and environment", () => {
    const text = written(BASE, {
      kind: "addJob",
      job: {
        ...newJob,
        needs: [{ job: "build" }],
        environment: { name: "prod", url: "https://u" },
      },
    });
    expect(needsOf(text, "lint")).toEqual(["build"]);
    expect(jobOf(text, "lint")?.environment?.value).toEqual({ name: "prod", url: "https://u" });
  });

  test("creates jobs: when missing", () => {
    const text = written("name: x\non: push\n", { kind: "addJob", job: newJob });
    expect(jobOf(text, "lint")).toBeDefined();
  });

  test("refusals: name taken, illegal name", () => {
    expect(run(BASE, { kind: "addJob", job: { ...newJob, id: "build" } })).toMatchObject({
      error: { code: "NAME_CONFLICT" },
    });
    expect(run(BASE, { kind: "addJob", job: { ...newJob, id: "a b" } })).toMatchObject({
      error: { code: "INVALID_NAME" },
    });
    expect(run(BASE, { kind: "addJob", job: { ...newJob, script: [] } })).toMatchObject({
      error: { params: { reason: "jobWithoutScript" } },
    });
  });

  test("a multiline or booby-trapped script stays a value", () => {
    const text = written(BASE, { kind: "addJob", job: { ...newJob, script: ["a: b #c", "x\ny"] } });
    expect(jobOf(text, "lint")?.signals.script).toEqual(["a: b #c", "x\ny"]);
  });
});

describe("addSnippet", () => {
  const snippet = "- name: Scan\n  run: trivy fs .\n";

  test("a job with checkout then the catalogue entry's steps", () => {
    const text = written(BASE, { kind: "addSnippet", id: "trivy", stage: "", snippet });
    const job = jobOf(text, "trivy");
    expect(job?.signals.script).toEqual(["trivy fs ."]);
    expect(job?.signals.actions?.[0]).toStartWith("actions/checkout@");
    expect(text).toContain("      - name: Scan\n        run: trivy fs .\n");
  });

  test.each([
    ["a map", "a: b\n"],
    ["an empty list", "[]\n"],
    ["a list of scalars", "- a\n"],
    ["broken YAML", "- [\n"],
    ["an anchor", "- &a\n  run: x\n"],
    ["an indented comment", "    # x\n- run: x\n"],
  ])("%s is refused", (_label, bad) => {
    expect(run(BASE, { kind: "addSnippet", id: "x", stage: "", snippet: bad })).toMatchObject({
      error: { params: { reason: "invalidSnippet" } },
    });
  });
});

describe("removeJob and renameJob", () => {
  test("removing keeps the neighbour's comment", () => {
    const text = written(BASE, { kind: "removeJob", id: "deploy" });
    expect(jobOf(text, "deploy")).toBeUndefined();
    expect(text).toContain("make check");
  });

  test("removing a job others need is refused", () => {
    expect(run(BASE, { kind: "removeJob", id: "build" })).toMatchObject({
      error: { code: "JOB_REFERENCED", params: { referencedBy: ["test", "deploy"] } },
    });
  });

  test("renaming follows needs, scalar and flow", () => {
    const text = written(BASE, { kind: "renameJob", from: "build", to: "compile" });
    expect(needsOf(text, "test")).toEqual(["compile"]);
    expect(needsOf(text, "deploy")).toEqual(["compile", "test"]);
    expect(text).toContain(
      "# compiles everything\n  compile:\n    runs-on: ubuntu-latest # fast\n",
    );
  });

  test("refusals: not found, name taken", () => {
    expect(run(BASE, { kind: "removeJob", id: "x" })).toMatchObject({
      error: { code: "JOB_NOT_FOUND" },
    });
    expect(run(BASE, { kind: "renameJob", from: "build", to: "test" })).toMatchObject({
      error: { code: "NAME_CONFLICT" },
    });
  });
});

describe("needs", () => {
  test("adding to a scalar, a flow list, a block list, nothing", () => {
    expect(
      needsOf(written(BASE, { kind: "addNeed", id: "test", need: { job: "deploy2" } }), "test"),
    ).toEqual(["build", "deploy2"]);
    expect(
      needsOf(written(BASE, { kind: "addNeed", id: "deploy", need: { job: "z" } }), "deploy"),
    ).toEqual(["build", "test", "z"]);
    expect(
      needsOf(written(BASE, { kind: "addNeed", id: "build", need: { job: "z" } }), "build"),
    ).toEqual(["z"]);
    const block =
      "jobs:\n  a:\n    needs:\n      - b # c\n    steps:\n      - run: x\n  b:\n    steps:\n      - run: x\n  z:\n    steps:\n      - run: x\n";
    const text = written(block, { kind: "addNeed", id: "a", need: { job: "z" } });
    expect(text).toContain("      - b # c\n      - z\n");
  });

  test("removing from a scalar drops the key, from a list keeps the rest", () => {
    expect(
      jobOf(written(BASE, { kind: "removeNeed", id: "test", job: "build" }), "test")?.needs,
    ).toBeNull();
    expect(
      needsOf(written(BASE, { kind: "removeNeed", id: "deploy", job: "build" }), "deploy"),
    ).toEqual(["test"]);
  });

  test("adding to an empty needs: writes the need as its value", () => {
    const text =
      "jobs:\n  a:\n    needs:\n    steps:\n      - run: x\n  z:\n    steps:\n      - run: x\n";
    const after = written(text, { kind: "addNeed", id: "a", need: { job: "z" } });
    expect(after).toBe(
      "jobs:\n  a:\n    needs: z\n    steps:\n      - run: x\n  z:\n    steps:\n      - run: x\n",
    );
    const commented =
      "jobs:\n  a:\n    needs: # later\n    steps:\n      - run: x\n  z:\n    steps:\n      - run: x\n";
    expect(written(commented, { kind: "addNeed", id: "a", need: { job: "z" } })).toContain(
      "    needs: z # later\n",
    );
  });

  test("removing from a multi-line flow list keeps its layout", () => {
    const text =
      "jobs:\n  a:\n    needs: [\n      b,\n      c,\n      d\n    ]\n    steps:\n      - run: x\n  b:\n    steps:\n      - run: x\n  c:\n    steps:\n      - run: x\n  d:\n    steps:\n      - run: x\n";
    expect(written(text, { kind: "removeNeed", id: "a", job: "c" })).toContain(
      "    needs: [\n      b,\n      d\n    ]\n",
    );
    expect(written(text, { kind: "removeNeed", id: "a", job: "d" })).toContain(
      "    needs: [\n      b,\n      c\n    ]\n",
    );
    expect(written(text, { kind: "removeNeed", id: "a", job: "b" })).toContain(
      "    needs: [\n      c,\n      d\n    ]\n",
    );
    expect(written(BASE, { kind: "removeNeed", id: "deploy", job: "test" })).toContain(
      "    needs: [build]\n",
    );
  });

  test("refusals: already there, absent, cycle, options", () => {
    expect(run(BASE, { kind: "addNeed", id: "test", need: { job: "build" } })).toMatchObject({
      error: { code: "NEED_EXISTS" },
    });
    expect(run(BASE, { kind: "removeNeed", id: "build", job: "x" })).toMatchObject({
      error: { code: "NEED_NOT_FOUND" },
    });
    expect(run(BASE, { kind: "addNeed", id: "build", need: { job: "deploy" } })).toMatchObject({
      error: { code: "CYCLE" },
    });
    expect(
      run(BASE, { kind: "addNeed", id: "build", need: { job: "z", optional: true } }),
    ).toMatchObject({
      error: { params: { reason: "notForProvider" } },
    });
  });
});

describe("environment", () => {
  test("add, replace, remove", () => {
    const added = written(BASE, {
      kind: "setEnvironment",
      id: "build",
      environment: { name: "prod" },
    });
    expect(jobOf(added, "build")?.environment?.value).toEqual({ name: "prod" });
    const replaced = written(added, {
      kind: "setEnvironment",
      id: "build",
      environment: { name: "s", url: "https://u" },
    });
    expect(jobOf(replaced, "build")?.environment?.value).toEqual({ name: "s", url: "https://u" });
    const removed = written(replaced, { kind: "setEnvironment", id: "build", environment: null });
    expect(jobOf(removed, "build")?.environment).toBeNull();
    expect(removed).toBe(BASE);
  });

  test("replacing a scalar environment keeps the comment of its line", () => {
    const text = "jobs:\n  a:\n    environment: prod # note\n    steps:\n      - run: x\n";
    expect(
      written(text, { kind: "setEnvironment", id: "a", environment: { name: "staging" } }),
    ).toBe("jobs:\n  a:\n    environment: staging # note\n    steps:\n      - run: x\n");
    const withUrl = written(text, {
      kind: "setEnvironment",
      id: "a",
      environment: { name: "s", url: "https://u" },
    });
    expect(withUrl).toContain("    environment: # note\n      name: s\n      url: https://u\n");
    expect(jobOf(withUrl, "a")?.environment?.value).toEqual({ name: "s", url: "https://u" });
  });

  test("action does not exist here", () => {
    expect(
      run(BASE, {
        kind: "setEnvironment",
        id: "build",
        environment: { name: "p", action: "stop" },
      }),
    ).toMatchObject({
      error: { params: { reason: "notForProvider" } },
    });
  });
});

describe("what makes no sense here", () => {
  test.each([
    [{ kind: "addStage", name: "x" }],
    [{ kind: "moveStage", name: "x", toIndex: 0 }],
    [{ kind: "setJobStage", id: "build", stage: "x" }],
  ])("%j is refused", (draft) => {
    expect(run(BASE, draft)).toMatchObject({ error: { params: { reason: "notForProvider" } } });
  });
});

describe("safeguards", () => {
  test("a stale hash", () => {
    const result = apply(parse(BASE, { file: FILE }).document, {
      v: 1,
      baseHash: "a".repeat(64),
      kind: "removeJob",
      id: "deploy",
    });
    expect(result.ok ? null : result.error.code).toBe("STALE_DOCUMENT");
  });

  test("a flow section is not rewritten", () => {
    expect(run("jobs: {a: {steps: [{run: x}]}}\n", { kind: "addJob", job: newJob })).toMatchObject({
      error: { code: "INVALID_OPERATION" },
    });
  });

  test("jobs written through an alias are shared: every edit is refused as such", () => {
    const text = "x-jobs: &j\n  a:\n    steps:\n      - run: x\njobs: *j\n";
    const sharedJobs = { error: { params: { reason: "sharedValue", job: "jobs", key: "jobs" } } };
    expect(run(text, { kind: "addJob", job: newJob })).toMatchObject(sharedJobs);
    expect(run(text, { kind: "removeJob", id: "a" })).toMatchObject(sharedJobs);
    expect(run(text, { kind: "addNeed", id: "a", need: { job: "z" } })).toMatchObject(sharedJobs);
  });

  test("a shape the patch cannot write is refused, not written", () => {
    const text = "jobs:\n  a: &a\n    steps:\n      - run: x\n  b: *a\n";
    expect(run(text, { kind: "addNeed", id: "a", need: { job: "z" } }).ok).toBe(false);
    expect(run(text, { kind: "removeJob", id: "a" }).ok).toBe(false);
  });

  test("a duplicate the patch would only half remove is refused on re-read", () => {
    const text =
      "jobs:\n  a:\n    needs:\n      - b\n      - b\n      - c\n    steps:\n      - run: x\n";
    expect(run(text, { kind: "removeNeed", id: "a", job: "b" })).toMatchObject({
      error: { params: { reason: "wouldBreakYaml" } },
    });
  });

  test("a job as a block value in last position keeps its neighbour", () => {
    const text =
      "jobs:\n  a:\n    steps:\n      - run: |\n          x\n  b:\n    steps:\n      - run: y\n";
    expect(jobOf(written(text, { kind: "removeJob", id: "a" }), "b")).toBeDefined();
  });
});

describe("what refers to the job outside needs", () => {
  const LINKED = `on:
  workflow_call:
    outputs:
      v:
        value: \${{ jobs.build.outputs.v }}
jobs:
  build:
    runs-on: x
    steps:
      - run: a
  deploy:
    needs: build
    if: needs.build.result == 'success'
    runs-on: x
    steps:
      - run: b
`;

  test("renaming a job cited by expressions is refused", () => {
    expect(run(LINKED, { kind: "renameJob", from: "build", to: "compile" })).toMatchObject({
      error: { params: { reason: "citedInExpression" } },
    });
  });

  test("removing a need the job cites is refused", () => {
    expect(run(LINKED, { kind: "removeNeed", id: "deploy", job: "build" })).toMatchObject({
      error: { params: { reason: "citedInExpression" } },
    });
  });

  test.each([
    ["brackets", "if: needs['build'].result == 'success'"],
    ["double quotes", 'if: needs["build"].result'],
    ["case", "if: NEEDS.Build.result"],
    ["spaces", "if: needs . build . result"],
  ])("the %s form is caught too", (_label, line) => {
    const text = `jobs:\n  build:\n    steps:\n      - run: a\n  deploy:\n    needs: build\n    ${line}\n    steps:\n      - run: b\n`;
    expect(run(text, { kind: "renameJob", from: "build", to: "compile" })).toMatchObject({
      error: { params: { reason: "citedInExpression", job: "build" } },
    });
  });

  test.each([
    [
      "a script comment",
      "      - run: |\n          # Wait for the other jobs.\n          test -f ready\n",
    ],
    ["a sentence", "      - run: echo Runs all jobs. Test only on main\n"],
    ["a Java class", "      - run: java com.acme.Jobs.Test\n"],
  ])("%s is not an expression", (_label, step) => {
    const text = `jobs:\n  test:\n    steps:\n${step}`;
    expect(run(text, { kind: "renameJob", from: "test", to: "other" }).ok).toBe(true);
  });

  test("a run citing the job in an expression is refused", () => {
    const text =
      "jobs:\n  a:\n    steps:\n      - run: x\n  b:\n    needs: a\n    steps:\n      - run: echo ${{ needs.a.outputs.v }}\n";
    expect(run(text, { kind: "renameJob", from: "a", to: "c" })).toMatchObject({
      error: { params: { reason: "citedInExpression" } },
    });
  });

  test("braces in an expression string do not cut it", () => {
    const text = `jobs:\n  a:\n    steps:\n      - run: x\n  b:\n    needs: a\n    steps:\n      - run: echo "\${{ format('{{0}}', needs.a.outputs.v) }}"\n`;
    expect(run(text, { kind: "renameJob", from: "a", to: "c" })).toMatchObject({
      error: { params: { reason: "citedInExpression" } },
    });
  });

  test("the shell after an expression is not an expression", () => {
    const text = `jobs:\n  test:\n    steps:\n      - run: |\n          echo "\${{ github.sha }}"\n          # Wait for the other jobs.\n          test -f ready\n`;
    expect(run(text, { kind: "renameJob", from: "test", to: "other" }).ok).toBe(true);
  });

  test.each([
    ["a matrix index", "${{ needs[matrix.dep].result }}"],
    ["whole needs", "${{ toJSON(needs) }}"],
    ["a computed index", "${{ needs[format('{0}', 'a')].result }}"],
  ])("%s can cite any job: refused", (_label, expression) => {
    const text = `jobs:\n  a:\n    steps:\n      - run: x\n  b:\n    needs: a\n    steps:\n      - run: echo "${expression}"\n`;
    expect(run(text, { kind: "renameJob", from: "a", to: "c" })).toMatchObject({
      error: { params: { reason: "dynamicExpression", job: "a" } },
    });
  });

  test.each([
    ["jobs indexed by an input", "${{ jobs[inputs.which].outputs.v }}"],
    ["whole jobs", "${{ toJSON(jobs) }}"],
  ])("%s in the outputs of a reusable workflow: refused", (_label, expression) => {
    const text = `on:\n  workflow_call:\n    outputs:\n      v:\n        value: ${expression}\njobs:\n  a:\n    steps:\n      - run: x\n`;
    for (const op of [
      { kind: "renameJob", from: "a", to: "c" },
      { kind: "removeJob", id: "a" },
    ] as const) {
      expect(run(text, op)).toMatchObject({
        error: { params: { reason: "dynamicExpression", job: "a" } },
      });
    }
  });

  test.each([
    [
      "a label in single quotes",
      "if: contains(github.event.pull_request.labels.*.name, 'needs-review')",
    ],
    ["a sentence in single quotes", "if: github.event.label.name == 'needs triage'"],
    ["an env property, in capitals", "if: env.NEEDS == 'x'"],
    ["an input", "if: inputs.needs"],
    ["a matrix variable", "if: matrix.needs"],
    ["a label containing jobs", "if: github.event.label.name == 'jobs'"],
  ])("%s does not read the needs context: renaming and removing stay allowed", (_label, line) => {
    const text = `jobs:\n  a:\n    steps:\n      - run: x\n  z:\n    steps:\n      - run: x\n  b:\n    needs: z\n    ${line}\n    steps:\n      - run: y\n`;
    expect(run(text, { kind: "renameJob", from: "a", to: "c" }).ok).toBe(true);
    expect(run(text, { kind: "removeJob", id: "a" }).ok).toBe(true);
  });

  test("needs['z'] targets z only: renaming another job stays allowed", () => {
    for (const index of ["needs['z']", 'needs["z"]']) {
      const text = `jobs:\n  a:\n    steps:\n      - run: x\n  z:\n    steps:\n      - run: x\n  b:\n    needs: [a, z]\n    if: ${index}.result == 'success'\n    steps:\n      - run: y\n`;
      expect(run(text, { kind: "renameJob", from: "a", to: "c" }).ok).toBe(true);
    }
  });

  test("every expression in a value is read, not just the first", () => {
    const text = `jobs:\n  a:\n    steps:\n      - run: x\n  b:\n    needs: a\n    steps:\n      - run: echo "\${{ github.sha }} \${{ needs.a.outputs.v }}"\n`;
    expect(run(text, { kind: "renameJob", from: "a", to: "c" })).toMatchObject({
      error: { params: { reason: "citedInExpression", job: "a" } },
    });
  });

  test("dynamic needs sees only its own job's needs: a job out of its reach stays free", () => {
    const text = `jobs:\n  a:\n    steps:\n      - run: x\n  b:\n    needs: a\n    if: \${{ toJSON(needs) != '' }}\n    steps:\n      - run: y\n  c:\n    steps:\n      - run: z\n`;
    expect(run(text, { kind: "renameJob", from: "c", to: "d" }).ok).toBe(true);
    expect(run(text, { kind: "removeJob", id: "c" }).ok).toBe(true);
    expect(run(text, { kind: "renameJob", from: "a", to: "d" })).toMatchObject({
      error: { params: { reason: "dynamicExpression", job: "a" } },
    });
  });

  test("the dynamic refusal also applies to removeNeed and removeJob", () => {
    const text = `jobs:\n  a:\n    steps:\n      - run: x\n  b:\n    needs: a\n    if: \${{ toJSON(needs) != '' }}\n    steps:\n      - run: y\n  c:\n    steps:\n      - run: z\n`;
    expect(run(text, { kind: "removeNeed", id: "b", job: "a" })).toMatchObject({
      error: { params: { reason: "dynamicExpression", job: "a" } },
    });
    const called = `on:\n  workflow_call:\n    outputs:\n      v:\n        value: \${{ toJSON(jobs) }}\n${text}`;
    expect(run(called, { kind: "removeJob", id: "c" })).toMatchObject({
      error: { params: { reason: "dynamicExpression", job: "c" } },
    });
  });

  test("needs.* targets no name: renaming stays allowed", () => {
    const text =
      "jobs:\n  a:\n    steps:\n      - run: x\n  b:\n    needs: a\n    if: contains(needs.*.result, 'failure')\n    steps:\n      - run: y\n";
    expect(run(text, { kind: "renameJob", from: "a", to: "c" }).ok).toBe(true);
  });

  test("an expression in a key counts", () => {
    const text = `jobs:\n  a:\n    steps:\n      - run: x\n  b:\n    needs: a\n    env:\n      \${{ needs.a.outputs.k }}: v\n    steps:\n      - run: y\n`;
    expect(run(text, { kind: "renameJob", from: "a", to: "c" })).toMatchObject({
      error: { params: { reason: "citedInExpression" } },
    });
  });

  test("a shell script reaches a job only through an expression, which is read", () => {
    const text = `jobs:\n  a:\n    steps:\n      - run: x\n  b:\n    needs: a\n    env:\n      ALL: \${{ toJSON(needs) }}\n    steps:\n      - run: echo "$ALL" | jq -r .a.result\n`;
    expect(run(text, { kind: "renameJob", from: "a", to: "c" })).toMatchObject({
      error: { params: { reason: "dynamicExpression", job: "a" } },
    });
    const bare =
      "jobs:\n  a:\n    steps:\n      - run: x\n  b:\n    needs: a\n    steps:\n      - run: echo needs.a.result\n";
    expect(run(bare, { kind: "renameJob", from: "a", to: "c" }).ok).toBe(true);
  });

  test.each([
    ["GITHUB_JOB in a script", '      - run: test "$GITHUB_JOB" = build && make\n'],
    ["github.job in an if", "      - if: github.job == 'build'\n        run: make\n"],
    ["github['job'] in an if", "      - if: github['job'] == 'build'\n        run: make\n"],
    ["github.job in a run", `      - run: '[ "\${{ github.job }}" = build ]'\n`],
  ])("a job comparing its own id at run time cannot be renamed: %s", (_label, step) => {
    const text = `jobs:\n  build:\n    steps:\n${step}`;
    expect(run(text, { kind: "renameJob", from: "build", to: "compile" })).toMatchObject({
      error: { params: { reason: "readsOwnId", job: "build" } },
    });
  });

  test("reading its own id without naming it leaves the job free to rename", () => {
    const text = `jobs:\n  build:\n    steps:\n      - run: echo "$GITHUB_JOB"\n      - uses: actions/cache@v4\n        with:\n          key: \${{ github.job }}-deps\n`;
    expect(run(text, { kind: "renameJob", from: "build", to: "compile" }).ok).toBe(true);
  });

  test("another job reading its own id does not block a rename", () => {
    const text = `jobs:\n  build:\n    steps:\n      - run: make\n  other:\n    steps:\n      - run: test "$GITHUB_JOB" = build\n`;
    expect(run(text, { kind: "renameJob", from: "build", to: "compile" }).ok).toBe(true);
  });

  test("a file whose values cannot be read is not rewritten", () => {
    const uses = Array.from({ length: 120 }, (_, index) => `  v${index}: *x\n`).join("");
    const text = `env:\n  a: &x [1]\n${uses}jobs:\n  build:\n    steps:\n      - run: a\n  b:\n    needs: build\n    if: needs.build.result\n    steps:\n      - run: y\n`;
    expect(run(text, { kind: "renameJob", from: "build", to: "compile" }).ok).toBe(false);
  });

  test("a comment blocks nothing", () => {
    const text = "jobs:\n  build:\n    # needs.build\n    steps:\n      - run: a\n";
    expect(run(text, { kind: "renameJob", from: "build", to: "compile" }).ok).toBe(true);
  });

  test("a step id with the same name prevents nothing", () => {
    const text =
      "jobs:\n  build:\n    steps:\n      - id: build\n        run: a\n  c:\n    steps:\n      - run: echo ${{ steps.build.outcome }}\n";
    expect(run(text, { kind: "renameJob", from: "build", to: "compile" }).ok).toBe(true);
  });

  test("environment on a uses: job is refused", () => {
    const text = "jobs:\n  a:\n    uses: o/r/.github/workflows/x.yml@v1\n";
    expect(
      run(text, { kind: "setEnvironment", id: "a", environment: { name: "p" } }),
    ).toMatchObject({
      error: { params: { reason: "notForProvider" } },
    });
  });
});

describe("almost empty files", () => {
  test.each([[""], ["# nothing\n"], ["name: x\n"]])("addJob on %j", (text) => {
    expect(run(text, { kind: "addJob", job: { id: "n", stage: "", script: ["x"] } }).ok).toBe(true);
  });

  test("a cyclic anchor does not throw", () => {
    const text = "x: &a\n  b: *a\njobs:\n  c:\n    steps:\n      - run: y\n";
    expect(() =>
      run(text, { kind: "addJob", job: { id: "n", stage: "", script: ["x"] } }),
    ).not.toThrow();
  });
});

describe("nothing changes alongside", () => {
  test.each([
    [
      "a |+ block at the end of a job",
      "jobs:\n  a:\n    steps:\n      - run: |+\n          foo\n\n\n",
      { kind: "addJob", job: { id: "n", stage: "", script: ["x"] } },
    ],
    [
      "an anchored needs cited elsewhere",
      "jobs:\n  z:\n    steps:\n      - run: x\n  a:\n    needs: &n z\n    env:\n      D: *n\n    steps:\n      - run: y\n  b:\n    steps:\n      - run: x\n",
      { kind: "addNeed", id: "a", need: { job: "b" } },
    ],
    [
      "a redefined anchor",
      "x-1: &x one\njobs:\n  a:\n    env:\n      V: &x two\n    steps:\n      - run: x\n  b:\n    env:\n      V: *x\n    steps:\n      - run: y\n",
      { kind: "removeJob", id: "a" },
    ],
    [
      "an anchored key",
      "jobs:\n  &k a:\n    env:\n      N: *k\n    steps:\n      - run: x\n",
      { kind: "renameJob", from: "a", to: "c" },
    ],
  ])("%s: refusal rather than a changed neighbouring value", (_label, text, draft) => {
    expect(run(text, draft as Draft).ok).toBe(false);
  });
});

describe("composite and inverse", () => {
  test("a composite is undone by a single splice", () => {
    const result = run(BASE, {
      kind: "composite",
      steps: [
        { kind: "addJob", job: newJob },
        { kind: "addNeed", id: "lint", need: { job: "build" } },
      ],
    });
    if (!result.ok) {
      throw new Error(JSON.stringify(result.error));
    }
    expect(result.value.touched).toHaveLength(1);
    const back = apply(
      parse(result.value.text, { file: FILE }).document,
      result.value.inverse as SpliceOperation,
    );
    expect(back.ok && back.value.text).toBe(BASE);
  });

  test("a refused step refuses everything", () => {
    expect(
      run(BASE, {
        kind: "composite",
        steps: [
          { kind: "addJob", job: newJob },
          { kind: "addStage", name: "x" },
        ],
      }).ok,
    ).toBe(false);
  });

  test("a splice outside the text is refused", () => {
    expect(run(BASE, { kind: "splice", start: 0, end: 1e6, text: "" })).toMatchObject({
      error: { code: "RANGE_OUT_OF_BOUNDS" },
    });
  });
});
