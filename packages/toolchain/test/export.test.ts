import { describe, expect, test } from "bun:test";
import { coverage, loadCatalog } from "@keelson/catalog";
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

describe("export Mermaid", () => {
  const text = renderMermaid(PIPELINE, TOOLCHAIN);

  test("un graphe par stage, dans l'ordre", () => {
    expect(text.startsWith("flowchart LR\n")).toBe(true);
    expect(text.indexOf('subgraph s0["build"]')).toBeLessThan(text.indexOf('subgraph s1["test"]'));
  });

  test("les dépendances et les intégrations sont des arêtes nommées", () => {
    expect(text).toContain("j0 --> j1");
    expect(text).toContain("j0 -->|push| v0");
  });

  test("un guillemet ne casse pas un libellé", () => {
    expect(text).toContain('j1["sc#quot;an|x"]');
  });

  test("déterministe", () => {
    expect(renderMermaid(PIPELINE, TOOLCHAIN)).toBe(text);
  });
});

describe("Mermaid sur des noms piégés", () => {
  test("un job d'un stage non déclaré reste dessiné", () => {
    const text = renderMermaid({ ...PIPELINE, jobs: [job("a", "security")] }, TOOLCHAIN);
    expect(text).toContain('["security"]');
    expect(text).toContain('j0["a"]');
  });

  test("une dépendance vers un job absent n'est pas dessinée", () => {
    const text = renderMermaid({ ...PIPELINE, jobs: [job("a", "build", ["absent"])] }, TOOLCHAIN);
    expect(text).not.toContain("-->");
  });

  test("une directive ne survit pas dans un libellé", () => {
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

describe("rapport de couverture", () => {
  const { tools } = loadCatalog();
  const result = coverage(PIPELINE, tools, {}, [], TOOLCHAIN.services);
  const text = renderCoverageMarkdown(result);

  test("dit le compte OWASP et plateforme", () => {
    expect(text).toContain("3 of 13 OWASP layers covered, 1 of 8 platform categories seen.");
  });

  test("une ligne par couche, un pipe de job échappé", () => {
    expect(text.split("\n").filter((line) => line.startsWith("| "))).toHaveLength(23);
    expect(text).toContain('sc"an\\|x');
  });

  test("les services sont nommés", () => {
    expect(text).toMatch(/Artifact repositories and registries \| yes \| {2}\| nexus \|/);
  });

  test("un pipeline partiel dit la borne basse", () => {
    expect(renderCoverageMarkdown({ ...result, partial: true })).toContain("lower bound");
  });
});
