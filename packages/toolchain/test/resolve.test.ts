import { describe, expect, test } from "bun:test";
import type { Tool } from "@keelson/catalog";
import { emptyPipeline, type Job, type Pipeline, type Toolchain } from "@keelson/core";
import { proposeIntegrations, validateToolchain } from "../src/index.ts";

function tool(id: string, integration: Tool["integration"]): Tool {
  return {
    id,
    name: id,
    kind: "service",
    layers: ["registry"],
    license: "MIT",
    homepage: "https://exemple.org",
    verifiedAt: "https://exemple.org",
    logo: null,
    integration,
    detect: { images: [], scripts: [`\\b${id}\\b`], actions: [] },
    snippets: { gitlab: null, github: null },
    lastVerified: "2026-11-04",
  };
}

const TOOLS = [tool("nexus", "push"), tool("vault", "fetch-secret")];

function pipeline(jobs: Record<string, string[]>, partial = false): Pipeline {
  return {
    ...emptyPipeline(".gitlab-ci.yml"),
    jobs: Object.entries(jobs).map(
      ([id, script]) => ({ id, signals: { image: null, script } }) as unknown as Job,
    ),
    unresolved: partial ? ([{ form: "remote", value: "x" }] as never) : [],
  } as Pipeline;
}

const chain = (partial: Partial<Toolchain> = {}): Toolchain => ({
  services: [],
  integrations: [],
  dismissed: [],
  ...partial,
});

const nexus = { id: "nexus-prod", tool: "nexus", url: null, environment: null };

describe("propositions", () => {
  test("un script qui nomme un service proposé, avec les services candidats", () => {
    expect(
      proposeIntegrations(
        pipeline({ build: ["nexus upload"] }),
        chain({ services: [nexus] }),
        TOOLS,
      ),
    ).toEqual([{ job: "build", tool: "nexus", kind: "push", services: ["nexus-prod"] }]);
  });

  test("sans service déclaré, la proposition reste, sans candidat", () => {
    expect(proposeIntegrations(pipeline({ build: ["nexus x"] }), chain(), TOOLS)).toEqual([
      { job: "build", tool: "nexus", kind: "push", services: [] },
    ]);
  });

  test("une intégration confirmée n'est plus proposée", () => {
    const declared = chain({
      services: [nexus],
      integrations: [{ job: "build", service: "nexus-prod", kind: "push" }],
    });
    expect(proposeIntegrations(pipeline({ build: ["nexus x"] }), declared, TOOLS)).toEqual([]);
  });

  test("une intégration écartée n'est plus proposée", () => {
    const declared = chain({ dismissed: [{ job: "build", tool: "nexus", kind: "push" }] });
    expect(proposeIntegrations(pipeline({ build: ["nexus x"] }), declared, TOOLS)).toEqual([]);
  });

  test("confirmer sur un autre type ne vaut pas confirmation", () => {
    const declared = chain({
      services: [nexus],
      integrations: [{ job: "build", service: "nexus-prod", kind: "notify" }],
    });
    expect(proposeIntegrations(pipeline({ build: ["nexus x"] }), declared, TOOLS)).toHaveLength(1);
  });
});

describe("deux workflows, un même nom de job", () => {
  test("une proposition ne se répète pas", () => {
    const twice = pipeline({ build: ["nexus x"] });
    const merged = { ...twice, jobs: [...twice.jobs, ...twice.jobs] };
    expect(proposeIntegrations(merged, chain(), TOOLS)).toHaveLength(1);
  });
});

describe("validation", () => {
  const codes = (toolchain: Toolchain, piped: Pipeline = pipeline({ build: [] })) =>
    validateToolchain(toolchain, piped, TOOLS).map((entry) => [entry.code, entry.severity]);

  test("une toolchain cohérente ne dit rien", () => {
    expect(
      codes(
        chain({
          services: [nexus],
          integrations: [{ job: "build", service: "nexus-prod", kind: "push" }],
        }),
      ),
    ).toEqual([]);
  });

  test("outil, service et job inconnus", () => {
    expect(
      codes(
        chain({
          services: [{ ...nexus, tool: "inconnu" }],
          integrations: [{ job: "fantome", service: "absent", kind: "push" }],
        }),
      ),
    ).toEqual([
      ["TOOLCHAIN_UNKNOWN_TOOL", "error"],
      ["TOOLCHAIN_UNKNOWN_SERVICE", "error"],
      ["TOOLCHAIN_UNKNOWN_JOB", "error"],
    ]);
  });

  test("sur un pipeline partiel, un job inconnu n'est qu'un warning", () => {
    expect(
      codes(
        chain({
          services: [nexus],
          integrations: [{ job: "fantome", service: "nexus-prod", kind: "push" }],
        }),
        pipeline({}, true),
      ),
    ).toEqual([["TOOLCHAIN_UNKNOWN_JOB", "warning"]]);
  });

  test("un doublon est signalé une fois", () => {
    const link = { job: "build", service: "nexus-prod", kind: "push" } as const;
    expect(codes(chain({ services: [nexus], integrations: [link, link, link] }))).toEqual([
      ["TOOLCHAIN_DUPLICATE_INTEGRATION", "warning"],
    ]);
  });
});
