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

describe("proposals", () => {
  test("a script naming a service is proposed, with the candidate services", () => {
    expect(
      proposeIntegrations(
        pipeline({ build: ["nexus upload"] }),
        chain({ services: [nexus] }),
        TOOLS,
      ),
    ).toEqual([{ job: "build", tool: "nexus", kind: "push", services: ["nexus-prod"] }]);
  });

  test("without a declared service, the proposal stays, without candidates", () => {
    expect(proposeIntegrations(pipeline({ build: ["nexus x"] }), chain(), TOOLS)).toEqual([
      { job: "build", tool: "nexus", kind: "push", services: [] },
    ]);
  });

  test("a confirmed integration is no longer proposed", () => {
    const declared = chain({
      services: [nexus],
      integrations: [{ job: "build", service: "nexus-prod", kind: "push" }],
    });
    expect(proposeIntegrations(pipeline({ build: ["nexus x"] }), declared, TOOLS)).toEqual([]);
  });

  test("a dismissed integration is no longer proposed", () => {
    const declared = chain({ dismissed: [{ job: "build", tool: "nexus", kind: "push" }] });
    expect(proposeIntegrations(pipeline({ build: ["nexus x"] }), declared, TOOLS)).toEqual([]);
  });

  test("confirming another kind does not count as confirmation", () => {
    const declared = chain({
      services: [nexus],
      integrations: [{ job: "build", service: "nexus-prod", kind: "notify" }],
    });
    expect(proposeIntegrations(pipeline({ build: ["nexus x"] }), declared, TOOLS)).toHaveLength(1);
  });
});

describe("two workflows, one job name", () => {
  test("a proposal is not repeated", () => {
    const twice = pipeline({ build: ["nexus x"] });
    const merged = { ...twice, jobs: [...twice.jobs, ...twice.jobs] };
    expect(proposeIntegrations(merged, chain(), TOOLS)).toHaveLength(1);
  });
});

describe("validation", () => {
  const codes = (toolchain: Toolchain, piped: Pipeline = pipeline({ build: [] })) =>
    validateToolchain(toolchain, piped, TOOLS).map((entry) => [entry.code, entry.severity]);

  test("a consistent toolchain reports nothing", () => {
    expect(
      codes(
        chain({
          services: [nexus],
          integrations: [{ job: "build", service: "nexus-prod", kind: "push" }],
        }),
      ),
    ).toEqual([]);
  });

  test("unknown tool, service and job", () => {
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

  test("on a partial pipeline, an unknown job is only a warning", () => {
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

  test("a duplicate is reported once", () => {
    const link = { job: "build", service: "nexus-prod", kind: "push" } as const;
    expect(codes(chain({ services: [nexus], integrations: [link, link, link] }))).toEqual([
      ["TOOLCHAIN_DUPLICATE_INTEGRATION", "warning"],
    ]);
  });
});
