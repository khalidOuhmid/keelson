import { describe, expect, test } from "bun:test";
import { isPartial } from "@keelson/core";
import { apply, parse } from "../src/index.ts";

const FILE = ".github/workflows/ci.yml";

function reader(files: Record<string, string>) {
  const reads: string[] = [];
  return {
    reads,
    read(path: string): string | null {
      reads.push(path);
      return files[path] ?? null;
    },
    candidates: () => Object.keys(files),
  };
}

const CALLER = `on: [push]
jobs:
  scans:
    uses: ./.github/workflows/scans.yml
    with:
      level: high
  deploy:
    needs: scans
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy
`;

const SCANS = `on: workflow_call
jobs:
  sast:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: semgrep scan --config auto
  image:
    runs-on: ubuntu-latest
    container: aquasec/trivy:0.50
    steps:
      - run: trivy fs .
`;

const jobOf = (result: ReturnType<typeof parse>, id: string) =>
  result.pipeline.jobs.find((entry) => entry.id === id);

describe("a local reusable workflow", () => {
  test("its jobs' signals become the calling job's signals", () => {
    const result = parse(CALLER, {
      file: FILE,
      read: reader({ ".github/workflows/scans.yml": SCANS }),
    });
    expect(jobOf(result, "scans")?.signals).toEqual({
      image: null,
      script: ["semgrep scan --config auto", "trivy fs ."],
      actions: ["actions/checkout@v4", "docker://aquasec/trivy:0.50"],
    });
  });

  test("once read, it is neither unresolved nor reported, and it counts as an included file", () => {
    const result = parse(CALLER, {
      file: FILE,
      read: reader({ ".github/workflows/scans.yml": SCANS }),
    });
    expect(result.diagnostics).toEqual([]);
    expect(isPartial(result.pipeline)).toBe(false);
    expect(result.pipeline.files).toEqual([FILE, ".github/workflows/scans.yml"]);
    expect(result.included).toEqual({ ".github/workflows/scans.yml": SCANS });
  });

  test("the calling job stays a single node: the callee's jobs are not added to the IR", () => {
    const result = parse(CALLER, {
      file: FILE,
      read: reader({ ".github/workflows/scans.yml": SCANS }),
    });
    expect(result.pipeline.jobs.map((entry) => entry.id)).toEqual(["scans", "deploy"]);
  });

  test("without a reader, nothing changes: the call stays unresolved", () => {
    const result = parse(CALLER, { file: FILE });
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(["WORKFLOW_UNRESOLVED"]);
    expect(isPartial(result.pipeline)).toBe(true);
    expect(result.included).toEqual({});
  });

  test("a remote workflow is not read even with a reader", () => {
    const files = reader({});
    const text = "jobs:\n  a:\n    uses: acme/ci/.github/workflows/scan.yml@v1\n";
    const result = parse(text, { file: FILE, read: files });
    expect(files.reads).toEqual([]);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(["WORKFLOW_UNRESOLVED"]);
  });

  test("a missing local workflow is an error, and the pipeline stays partial", () => {
    const result = parse(CALLER, { file: FILE, read: reader({}) });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "WORKFLOW_CALL_INVALID",
        severity: "error",
        params: { reason: "missing", job: "scans", path: ".github/workflows/scans.yml" },
        file: FILE,
      }),
    ]);
    expect(result.pipeline.unresolved).toEqual([
      expect.objectContaining({ form: "workflow", detail: "./.github/workflows/scans.yml" }),
    ]);
  });

  test.each([
    ["../outside.yml", "outsideRoot", "../outside.yml"],
    ["./.github/workflows/../../etc/x.yml", "outsideRoot", "./.github/workflows/../../etc/x.yml"],
    ["./ci/scans.yml", "notInWorkflows", "ci/scans.yml"],
    ["./.github/workflows/sub/scans.yml", "notInWorkflows", ".github/workflows/sub/scans.yml"],
    ["./.github/workflows/scans.json", "notInWorkflows", ".github/workflows/scans.json"],
  ])("%s is refused before any read (%s)", (target, reason, path) => {
    const files = reader({});
    const text = `jobs:\n  a:\n    uses: ${target}\n`;
    const result = parse(text, { file: FILE, read: files });
    expect(files.reads).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      code: "WORKFLOW_CALL_INVALID",
      params: { reason, job: "a", path },
    });
  });

  test("nested local workflows are read, and a nested remote one keeps the pipeline partial", () => {
    const outer = "jobs:\n  a:\n    uses: ./.github/workflows/b.yml\n";
    const b =
      "on: workflow_call\njobs:\n  inner:\n    uses: ./.github/workflows/c.yml\n  remote:\n    uses: acme/x/.github/workflows/y.yml@v1\n";
    const c = "on: workflow_call\njobs:\n  scan:\n    steps:\n      - run: gitleaks detect\n";
    const result = parse(outer, {
      file: FILE,
      read: reader({ ".github/workflows/b.yml": b, ".github/workflows/c.yml": c }),
    });
    expect(jobOf(result, "a")?.signals.script).toEqual(["gitleaks detect"]);
    expect(result.pipeline.files).toEqual([
      FILE,
      ".github/workflows/b.yml",
      ".github/workflows/c.yml",
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "WORKFLOW_UNRESOLVED",
        params: { job: "remote", target: "acme/x/.github/workflows/y.yml@v1" },
        file: ".github/workflows/b.yml",
      }),
    ]);
    const range = result.diagnostics[0]?.range;
    expect(b.slice(range?.start, range?.end)).toStartWith("remote:");
    expect(result.pipeline.unresolved).toEqual([
      expect.objectContaining({ from: ".github/workflows/b.yml" }),
    ]);
  });

  test("a cycle is reported once, located in the file that closes it", () => {
    const outer = "jobs:\n  a:\n    uses: ./.github/workflows/b.yml\n";
    const b =
      "on: workflow_call\njobs:\n  back:\n    uses: ./.github/workflows/b.yml\n  scan:\n    steps:\n      - run: trivy fs .\n";
    const result = parse(outer, { file: FILE, read: reader({ ".github/workflows/b.yml": b }) });
    expect(jobOf(result, "a")?.signals.script).toEqual(["trivy fs ."]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "WORKFLOW_CALL_INVALID",
        params: {
          reason: "cycle",
          job: "back",
          trail: [".github/workflows/b.yml", ".github/workflows/b.yml"],
        },
        file: ".github/workflows/b.yml",
      }),
    ]);
  });

  test("the main workflow calling itself is a cycle too", () => {
    const text = "jobs:\n  a:\n    uses: ./.github/workflows/ci.yml\n";
    const result = parse(text, { file: FILE, read: reader({ [FILE]: text }) });
    expect(result.diagnostics[0]?.params).toEqual({
      reason: "cycle",
      job: "a",
      trail: [FILE, FILE],
    });
  });

  test("nesting deeper than GitHub's ten levels stops with an error", () => {
    const files: Record<string, string> = {};
    for (let level = 1; level <= 12; level += 1) {
      files[`.github/workflows/w${level}.yml`] =
        `on: workflow_call\njobs:\n  next:\n    uses: ./.github/workflows/w${level + 1}.yml\n  own:\n    steps:\n      - run: step ${level}\n`;
    }
    const text = "jobs:\n  a:\n    uses: ./.github/workflows/w1.yml\n";
    const result = parse(text, { file: FILE, read: reader(files) });
    expect(jobOf(result, "a")?.signals.script).toEqual(
      Array.from({ length: 9 }, (_, index) => `step ${9 - index}`),
    );
    expect(result.diagnostics.map((entry) => entry.params)).toEqual([
      { reason: "depth", job: "next", path: ".github/workflows/w10.yml", limit: 10 },
    ]);
    expect(isPartial(result.pipeline)).toBe(true);
  });

  test("more than fifty unique reusable workflows stops with an error", () => {
    const files: Record<string, string> = {};
    const calls = Array.from(
      { length: 51 },
      (_, index) => `  c${index}:\n    uses: ./.github/workflows/w${index}.yml\n`,
    ).join("");
    for (let index = 0; index < 51; index += 1) {
      files[`.github/workflows/w${index}.yml`] =
        `on: workflow_call\njobs:\n  own:\n    steps:\n      - run: step ${index}\n`;
    }
    const result = parse(`jobs:\n${calls}`, { file: FILE, read: reader(files) });
    expect(result.diagnostics.map((entry) => entry.params)).toEqual([
      { reason: "limit", job: "c50", path: ".github/workflows/w50.yml", limit: 50 },
    ]);
    expect(jobOf(result, "c49")?.signals.script).toEqual(["step 49"]);
    expect(jobOf(result, "c50")?.signals.script).toEqual([]);
  });

  test("a workflow called twice is read once", () => {
    const files = reader({ ".github/workflows/scans.yml": SCANS });
    const text =
      "jobs:\n  a:\n    uses: ./.github/workflows/scans.yml\n  b:\n    uses: ./.github/workflows/scans.yml\n";
    const result = parse(text, { file: FILE, read: files });
    expect(files.reads).toEqual([".github/workflows/scans.yml"]);
    expect(jobOf(result, "b")?.signals.script).toEqual(jobOf(result, "a")?.signals.script ?? []);
    expect(result.pipeline.files).toEqual([FILE, ".github/workflows/scans.yml"]);
  });

  test("a callee that is not a workflow map adds nothing and breaks nothing", () => {
    for (const body of ["", "just text\n", "jobs: [\n"]) {
      const result = parse(CALLER, {
        file: FILE,
        read: reader({ ".github/workflows/scans.yml": body }),
      });
      expect(jobOf(result, "scans")?.signals).toEqual({ image: null, script: [] });
      expect(jobOf(result, "deploy")?.signals.script).toEqual(["./deploy"]);
    }
  });
});

describe("a local composite action", () => {
  const STEPS = `jobs:
  a:
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/scan
      - run: make
`;

  test("its steps add their run and uses to the job's signals", () => {
    const action = `name: scan
runs:
  using: composite
  steps:
    - run: gitleaks detect
      shell: bash
    - uses: aquasecurity/trivy-action@0.28.0
`;
    const result = parse(STEPS, {
      file: FILE,
      read: reader({ ".github/actions/scan/action.yml": action }),
    });
    expect(result.pipeline.jobs[0]?.signals).toEqual({
      image: null,
      script: ["gitleaks detect", "make"],
      actions: [
        "actions/checkout@v4",
        "./.github/actions/scan",
        "aquasecurity/trivy-action@0.28.0",
      ],
    });
    expect(result.pipeline.files).toEqual([FILE, ".github/actions/scan/action.yml"]);
    expect(result.included).toEqual({ ".github/actions/scan/action.yml": action });
    expect(result.diagnostics).toEqual([]);
  });

  test("action.yaml is read when action.yml does not exist", () => {
    const action = "runs:\n  using: composite\n  steps:\n    - run: semgrep scan\n";
    const result = parse(STEPS, {
      file: FILE,
      read: reader({ ".github/actions/scan/action.yaml": action }),
    });
    expect(result.pipeline.jobs[0]?.signals.script).toEqual(["semgrep scan", "make"]);
  });

  test("a Docker action contributes its image", () => {
    const action = "runs:\n  using: docker\n  image: docker://zricethezav/gitleaks:v8\n";
    const result = parse(STEPS, {
      file: FILE,
      read: reader({ ".github/actions/scan/action.yml": action }),
    });
    expect(result.pipeline.jobs[0]?.signals.actions).toContain("docker://zricethezav/gitleaks:v8");
  });

  test("nested composite actions are followed, and a cycle stops without an error", () => {
    const outer = "runs:\n  using: composite\n  steps:\n    - uses: ./tools/inner\n";
    const inner =
      "runs:\n  using: composite\n  steps:\n    - run: checkov -d .\n    - uses: ./.github/actions/scan\n";
    const result = parse(STEPS, {
      file: FILE,
      read: reader({
        ".github/actions/scan/action.yml": outer,
        "tools/inner/action.yml": inner,
      }),
    });
    expect(result.pipeline.jobs[0]?.signals.script).toEqual(["checkov -d .", "make"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("a missing or out-of-root action is silent: it may come from another checkout", () => {
    const files = reader({});
    const text = "jobs:\n  a:\n    steps:\n      - uses: ./missing\n      - uses: ../escape\n";
    const result = parse(text, { file: FILE, read: files });
    expect(files.reads).toEqual(["missing/action.yml", "missing/action.yaml"]);
    expect(result.diagnostics).toEqual([]);
    expect(isPartial(result.pipeline)).toBe(false);
    expect(result.pipeline.jobs[0]?.signals.actions).toEqual(["./missing", "../escape"]);
  });

  test("an action used by a called workflow counts for the calling job", () => {
    const callee =
      "on: workflow_call\njobs:\n  s:\n    steps:\n      - uses: ./.github/actions/scan\n";
    const action = "runs:\n  using: composite\n  steps:\n    - run: grype dir:.\n";
    const result = parse(CALLER, {
      file: FILE,
      read: reader({
        ".github/workflows/scans.yml": callee,
        ".github/actions/scan/action.yml": action,
      }),
    });
    expect(jobOf(result, "scans")?.signals.script).toEqual(["grype dir:."]);
  });
});

describe("strategy.matrix", () => {
  test("a run citing a matrix value yields one line per value", () => {
    const text = `jobs:
  scan:
    strategy:
      matrix:
        tool: [trivy, grype]
        include:
          - tool: syft
    steps:
      - run: \${{ matrix.tool }} dir:.
`;
    expect(parse(text, { file: FILE }).pipeline.jobs[0]?.signals.script).toEqual([
      "trivy dir:.",
      "grype dir:.",
      "syft dir:.",
    ]);
  });

  test("several keys combine, a container image too, and the job stays one node", () => {
    const text = `jobs:
  scan:
    container: \${{ matrix.image }}
    strategy:
      matrix:
        image: [aquasec/trivy, anchore/grype]
        mode: [fs, config]
    steps:
      - run: run \${{matrix.mode}} on \${{ matrix.image }}
`;
    const { jobs } = parse(text, { file: FILE }).pipeline;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.signals).toEqual({
      image: "aquasec/trivy",
      script: [
        "run fs on aquasec/trivy",
        "run config on aquasec/trivy",
        "run fs on anchore/grype",
        "run config on anchore/grype",
      ],
      actions: ["docker://anchore/grype"],
    });
  });

  test("a matrix without literal values leaves the line as written", () => {
    const text = `jobs:
  scan:
    strategy:
      matrix: \${{ fromJSON(needs.plan.outputs.m) }}
    steps:
      - run: \${{ matrix.tool }} scan
      - run: echo \${{ matrix.other }}
`;
    expect(parse(text, { file: FILE }).pipeline.jobs[0]?.signals.script).toEqual([
      `\${{ matrix.tool }} scan`,
      `echo \${{ matrix.other }}`,
    ]);
  });

  test("the product is capped: a huge matrix does not explode the signals", () => {
    const values = Array.from({ length: 20 }, (_, index) => `v${index}`).join(", ");
    const text = `jobs:\n  a:\n    strategy:\n      matrix:\n        x: [${values}]\n        y: [${values}]\n        z: [${values}]\n    steps:\n      - run: echo \${{ matrix.x }} \${{ matrix.y }} \${{ matrix.z }}\n`;
    const script = parse(text, { file: FILE }).pipeline.jobs[0]?.signals.script ?? [];
    expect(script.length).toBe(64);
    expect(script[0]).toBe("echo v0 v0 v0");
  });
});

describe("editing a workflow that calls a local one", () => {
  test("the re-read IR keeps the called jobs' signals and the included texts", () => {
    const { document } = parse(CALLER, {
      file: FILE,
      read: reader({ ".github/workflows/scans.yml": SCANS }),
    });
    const result = apply(document, {
      v: 1,
      baseHash: document.hash,
      kind: "renameJob",
      from: "deploy",
      to: "release",
    });
    if (!result.ok) {
      throw new Error(JSON.stringify(result.error));
    }
    expect(result.value.pipeline.jobs[0]?.signals.script).toEqual([
      "semgrep scan --config auto",
      "trivy fs .",
    ]);
    expect(result.value.included).toEqual({ ".github/workflows/scans.yml": SCANS });
    expect(isPartial(result.value.pipeline)).toBe(false);
  });
});
