import { describe, expect, test } from "bun:test";
import { coverage, loadCatalog, lowerBoundNote } from "@keelson/catalog";
import { emptyPipeline, type Job, type Pipeline, type Toolchain } from "@keelson/core";
import { renderCoverageMarkdown, renderMermaid } from "../src/index.ts";

function job(id: string, stage: string, needs: string[] = [], script: string[] = []): Job {
  return {
    id,
    stage: { value: stage, origin: { kind: "local" } },
    needs:
      needs.length === 0
        ? null
        : {
            value: needs.map((need) => ({ job: need, optional: false, artifacts: true })),
            origin: { kind: "local" },
          },
    signals: { image: null, script },
    file: ".gitlab-ci.yml",
  } as unknown as Job;
}

const PIPELINE: Pipeline = {
  ...emptyPipeline(".gitlab-ci.yml"),
  stages: [
    { name: "build", implicit: false },
    { name: "test", implicit: false },
  ] as Pipeline["stages"],
  jobs: [job("compile", "build"), job('sc"an|x', "test", ["compile"], ["trivy fs ."])],
};

const TOOLCHAIN: Toolchain = {
  services: [{ id: "nexus", tool: "nexus", url: null, environment: "prod" }],
  integrations: [{ job: "compile", service: "nexus", kind: "push" }],
  dismissed: [],
};

describe("Mermaid export", () => {
  const text = renderMermaid(PIPELINE, TOOLCHAIN);

  test("one subgraph per stage, in order", () => {
    expect(text.startsWith("flowchart LR\n")).toBe(true);
    expect(text.indexOf('subgraph s0["build"]')).toBeLessThan(text.indexOf('subgraph s1["test"]'));
  });

  test("dependencies and integrations are labelled edges", () => {
    expect(text).toContain("j0 --> j1");
    expect(text).toContain("j0 -->|push| v0");
  });

  test("a quote does not break a label", () => {
    expect(text).toContain('j1["sc#quot;an|x"]');
  });

  test("deterministic", () => {
    expect(renderMermaid(PIPELINE, TOOLCHAIN)).toBe(text);
  });
});

describe("Mermaid on booby-trapped names", () => {
  test("a job of an undeclared stage is still drawn", () => {
    const text = renderMermaid({ ...PIPELINE, jobs: [job("a", "security")] }, TOOLCHAIN);
    expect(text).toContain('["security"]');
    expect(text).toContain('j0["a"]');
  });

  test("a dependency on a missing job is not drawn", () => {
    const text = renderMermaid({ ...PIPELINE, jobs: [job("a", "build", ["absent"])] }, TOOLCHAIN);
    expect(text).not.toContain("-->");
  });

  test("a directive does not survive in a label", () => {
    const text = renderMermaid(
      { ...PIPELINE, jobs: [job("x%%{init: {'theme':'forest'}}%%y#z\nw", "build")] },
      TOOLCHAIN,
    );
    expect(text).not.toContain("%%");
    expect(text).toContain("#37;#37;{init");
    expect(text).toContain("y#35;z w");
    expect(text.split("\n").filter((line) => line.includes("j0["))).toHaveLength(1);
  });
});

describe("two workflows, one job name", () => {
  test("both nodes stay, each dependency in its own file", () => {
    const one = { ...job("scan", "build"), file: "a.yml" } as Job;
    const two = { ...job("scan", "build", ["x"]), file: "b.yml" } as Job;
    const needed = { ...job("x", "build"), file: "b.yml" } as Job;
    const text = renderMermaid(
      { ...PIPELINE, jobs: [one, two, needed] },
      { ...TOOLCHAIN, integrations: [] },
    );
    expect(text).toContain('j0["scan"]');
    expect(text).toContain('j1["scan"]');
    expect(text).toContain("j2 --> j1");
  });
});

describe("needs across files", () => {
  test("a dependency on a job in another file is still drawn", () => {
    const main = { ...job("a", "build"), file: ".gitlab-ci.yml" } as Job;
    const included = { ...job("b", "build", ["a"]), file: "ci/inc.yml" } as Job;
    const text = renderMermaid(
      { ...PIPELINE, jobs: [main, included] },
      { ...TOOLCHAIN, integrations: [] },
    );
    expect(text).toContain("j0 --> j1");
  });

  test("two workflows are not linked", () => {
    const one = { ...job("deploy", "build", ["build"]), file: ".github/workflows/a.yml" } as Job;
    const two = { ...job("build", "build"), file: ".github/workflows/b.yml" } as Job;
    const text = renderMermaid(
      { ...PIPELINE, jobs: [one, two] },
      { ...TOOLCHAIN, integrations: [] },
    );
    expect(text).not.toContain("-->");
  });

  test("an integration starts from every job with that name", () => {
    const one = { ...job("compile", "build"), file: "a.yml" } as Job;
    const two = { ...job("compile", "build"), file: "b.yml" } as Job;
    const text = renderMermaid({ ...PIPELINE, jobs: [one, two] }, TOOLCHAIN);
    expect(text).toContain("j0 -->|push| v0");
    expect(text).toContain("j1 -->|push| v0");
  });
});

describe("coverage report", () => {
  const { tools } = loadCatalog();
  const result = coverage(PIPELINE, tools, {}, [], TOOLCHAIN.services);
  const text = renderCoverageMarkdown(result, null);

  test("states the OWASP and platform counts", () => {
    expect(text).toContain("3 of 13 OWASP layers covered, 2 of 8 platform categories seen.");
  });

  test("the CI that proves source control is named with the services", () => {
    expect(text).toContain("| Source control | yes |  | ci gitlab-ci |");
  });

  test("one row per layer, a job pipe escaped", () => {
    expect(text.split("\n").filter((line) => line.startsWith("| "))).toHaveLength(23);
    expect(text).toContain('sc"an\\|x');
  });

  test("services are named", () => {
    expect(text).toMatch(/Artifact repositories and registries \| yes \| {2}\| nexus \|/);
  });

  test("a line break in a job or service name stays inside its cell", () => {
    const broken = coverage(
      { ...PIPELINE, jobs: [job("scan\r\n| x |\nnext", "test", [], ["trivy fs ."])] },
      tools,
      {},
      [],
      [{ id: "nex\nus", tool: "nexus", url: null, environment: "prod" }],
    );
    const lines = renderCoverageMarkdown(broken, null).split("\n");
    expect(lines.filter((line) => line.startsWith("| "))).toHaveLength(23);
    expect(lines.every((line) => line === "" || /^[#|C0-9]/.test(line))).toBe(true);
    expect(lines.join("\n")).toContain("scan \\| x \\| next");
    expect(lines.join("\n")).toContain("nex us");
  });

  test("a partial pipeline states the shared lower-bound sentence for its cause", () => {
    for (const cause of ["invalidYaml", "unresolvedInclude", "unresolvedWorkflow"] as const) {
      const lines = renderCoverageMarkdown({ ...result, partial: true }, cause).split("\n");
      expect(lines).toContain(lowerBoundNote(cause));
    }
  });

  test("a complete pipeline states no lower bound", () => {
    expect(renderCoverageMarkdown(result, null)).not.toContain("lower bound");
  });
});
