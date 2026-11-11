import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Tool } from "@keelson/catalog";
import type { Toolchain } from "@keelson/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ToolchainPayload } from "../src/api/client.ts";
import { toolchainGraph } from "../src/views/toolchain/graph.ts";
import { ServicePanel } from "../src/views/toolchain/ServicePanel.tsx";
import { ToolchainPanel } from "../src/views/toolchain/ToolchainPanel.tsx";

function tool(id: string, integration: Tool["integration"] = "push"): Tool {
  return {
    id,
    name: `${id[0]?.toUpperCase()}${id.slice(1)}`,
    kind: "service",
    layers: ["registry"],
    license: "MIT",
    homepage: "https://exemple.org",
    verifiedAt: "https://exemple.org",
    logo: null,
    integration,
    detect: { images: [], scripts: [], actions: [] },
    snippets: { gitlab: null, github: null },
    lastVerified: "2026-11-04",
  };
}

const TOOLS = [tool("nexus"), { ...tool("vault", "fetch-secret"), name: "HashiCorp" }];
const NEXUS = { id: "nexus-prod", tool: "nexus", url: null, environment: "production" };

afterEach(cleanup);

function payload(
  partial: Partial<Omit<ToolchainPayload, "toolchain">> & { toolchain?: Partial<Toolchain> } = {},
) {
  return {
    text: "",
    hash: "a",
    diagnostics: [],
    proposed: [],
    positions: {},
    ...partial,
    toolchain: { services: [], integrations: [], dismissed: [], ...partial.toolchain },
  } as ToolchainPayload;
}

function panel(value: ToolchainPayload) {
  const onSubmit = mock(() => {});
  const onSelectService = mock(() => {});
  render(
    <ToolchainPanel
      payload={value}
      tools={TOOLS}
      disabled={false}
      selectedService={null}
      onSubmit={onSubmit}
      onSelectService={onSelectService}
    />,
  );
  return { onSubmit, onSelectService };
}

describe("toolchain panel", () => {
  test("nothing to confirm, no service: both states say so", () => {
    panel(payload());
    expect(screen.getByText("Nothing to confirm.")).toBeDefined();
    expect(screen.getAllByText("No services declared yet.")).toHaveLength(1);
  });

  test("confirming a proposal sends the integration", async () => {
    const { onSubmit } = panel(
      payload({
        proposed: [{ job: "build", tool: "nexus", kind: "push", services: ["nexus-prod"] }],
        toolchain: { services: [NEXUS] },
      }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm push from build to nexus-prod" }),
    );
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "addIntegration",
      job: "build",
      service: "nexus-prod",
      integration: "push",
    });
  });

  test("with two candidate services, the choice applies to the confirmation", async () => {
    const { onSubmit } = panel(
      payload({
        proposed: [{ job: "b", tool: "nexus", kind: "push", services: ["a", "z"] }],
        toolchain: { services: [] },
      }),
    );
    await userEvent.selectOptions(screen.getByLabelText("Service for b"), "z");
    await userEvent.click(screen.getByRole("button", { name: "Confirm push from b to z" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ service: "z" }));
  });

  test("dismissing a proposal", async () => {
    const { onSubmit } = panel(
      payload({ proposed: [{ job: "b", tool: "nexus", kind: "push", services: [] }] }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Dismiss push from b to Nexus" }));
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "dismissIntegration",
      job: "b",
      tool: "nexus",
      integration: "push",
    });
  });

  test("without a service, the proposal prefills the form", async () => {
    panel(
      payload({
        proposed: [{ job: "b", tool: "vault", kind: "fetch-secret", services: [] }],
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Add a service for b, HashiCorp" }));
    expect((screen.getByLabelText("Tool") as HTMLSelectElement).value).toBe("vault");
  });

  test("adding a service, the name falls back to the tool", async () => {
    const { onSubmit } = panel(payload());
    await userEvent.type(screen.getByLabelText("URL"), "https://n");
    const form = screen.getByRole("group", { name: "New service" });
    await userEvent.click(within(form).getByRole("button", { name: "Add service" }));
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "addService",
      id: "nexus",
      tool: "nexus",
      url: "https://n",
      environment: null,
    });
  });

  test("a dismissed proposal can be restored, and the section only exists when useful", async () => {
    const { onSubmit } = panel(
      payload({
        toolchain: { dismissed: [{ job: "b", tool: "nexus", kind: "push" }] },
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Restore push from b to Nexus" }));
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "restoreIntegration",
      job: "b",
      tool: "nexus",
      integration: "push",
    });
  });

  test("an invalid file says so, instead of announcing an empty toolchain", () => {
    render(
      <ToolchainPanel
        payload={payload()}
        tools={TOOLS}
        disabled
        invalid
        selectedService={null}
        onSubmit={mock(() => {})}
        onSelectService={mock(() => {})}
      />,
    );
    expect(screen.getByText(/can't be read/)).toBeDefined();
    expect(screen.queryByText("No services declared yet.")).toBeNull();
  });

  test("the heading counts pending decisions", () => {
    panel(payload({ proposed: [{ job: "b", tool: "nexus", kind: "push", services: [] }] }));
    expect(screen.getByRole("heading", { name: /Proposed integrations/ }).textContent).toContain(
      "1",
    );
  });

  test("each service lists its integrations: edges can be read here from the keyboard", () => {
    panel(
      payload({
        toolchain: {
          services: [NEXUS],
          integrations: [{ job: "build", service: "nexus-prod", kind: "push" }],
        },
      }),
    );
    expect(screen.getByRole("group", { name: "Services" }).textContent).toContain("build push");
  });

  test("a rejected input stays in the form", async () => {
    const onSubmit = mock(async () => false);
    render(
      <ToolchainPanel
        payload={payload()}
        tools={TOOLS}
        disabled={false}
        selectedService={null}
        onSubmit={onSubmit}
        onSelectService={mock(() => {})}
      />,
    );
    await userEvent.type(screen.getByLabelText("URL"), "https://n");
    const form = screen.getByRole("group", { name: "New service" });
    await userEvent.click(within(form).getByRole("button", { name: "Add service" }));
    expect((screen.getByLabelText("URL") as HTMLInputElement).value).toBe("https://n");
  });

  test("a proposal without a service moves focus to the name", async () => {
    panel(payload({ proposed: [{ job: "b", tool: "vault", kind: "fetch-secret", services: [] }] }));
    await userEvent.click(screen.getByRole("button", { name: "Add a service for b, HashiCorp" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
  });

  test("a service can be selected from the list with the keyboard", async () => {
    const { onSelectService } = panel(payload({ toolchain: { services: [NEXUS] } }));
    await userEvent.click(screen.getByRole("button", { name: /nexus-prod/ }));
    expect(onSelectService).toHaveBeenCalledWith("nexus-prod");
  });
});

describe("service panel", () => {
  function service(linked = false) {
    const onSubmit = mock(() => {});
    render(
      <ServicePanel
        service={NEXUS}
        toolchain={{
          services: [NEXUS],
          integrations: linked ? [{ job: "build", service: "nexus-prod", kind: "push" }] : [],
          dismissed: [],
        }}
        tool={TOOLS[0]}
        jobs={["build", "deploy"]}
        disabled={false}
        onSubmit={onSubmit}
        onClose={() => {}}
      />,
    );
    return onSubmit;
  }

  test("removing is refused upfront, with the reason, while a job is linked to it", () => {
    service(true);
    expect(
      (screen.getByRole("button", { name: "Remove service" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("Still used by build.")).toBeDefined();
  });

  test("saving clears a field with null", async () => {
    const onSubmit = service();
    await userEvent.clear(screen.getByLabelText("Environment"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "updateService",
      id: "nexus-prod",
      url: null,
      environment: null,
    });
  });

  test("adding an integration by hand, the catalogue entry's type by default", async () => {
    const onSubmit = service();
    await userEvent.selectOptions(screen.getByLabelText("Job"), "deploy");
    await userEvent.click(screen.getByRole("button", { name: "Add integration" }));
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "addIntegration",
      job: "deploy",
      service: "nexus-prod",
      integration: "push",
    });
  });

  test("a job gone from the pipeline is never written", async () => {
    const onSubmit = mock(() => {});
    const props = {
      service: NEXUS,
      toolchain: { services: [NEXUS], integrations: [], dismissed: [] },
      tool: TOOLS[0],
      disabled: false,
      onSubmit,
      onClose: () => {},
    };
    const { rerender } = render(<ServicePanel {...props} jobs={["build", "deploy"]} />);
    rerender(<ServicePanel {...props} jobs={["deploy"]} />);
    await userEvent.click(screen.getByRole("button", { name: "Add integration" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ job: "deploy" }));
  });

  test("removing an integration", async () => {
    const onSubmit = service(true);
    await userEvent.click(screen.getByRole("button", { name: "Remove push from build" }));
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "removeIntegration",
      job: "build",
      service: "nexus-prod",
      integration: "push",
    });
  });
});

describe("graph", () => {
  const METRICS = { nodeWidth: 200, nodeHeight: 60, columnGap: 50, rowGap: 20 };
  const LINK = { job: "build", service: "nexus-prod", kind: "push" } as const;
  const chain = { services: [NEXUS], integrations: [LINK], dismissed: [] };

  test("two columns without a saved position", () => {
    const { nodes } = toolchainGraph(chain, [], {}, new Map(), METRICS, null);
    expect(nodes.map((node) => [node.id, node.position])).toEqual([
      ["job:build", { x: 0, y: 0 }],
      ["service:nexus-prod", { x: 350, y: 0 }],
    ]);
  });

  test("a saved position wins", () => {
    const { nodes } = toolchainGraph(
      chain,
      [],
      { "service:nexus-prod": { x: 5, y: 6 } },
      new Map(),
      METRICS,
      null,
    );
    expect(nodes[1]?.position).toEqual({ x: 5, y: 6 });
  });

  test("an integration is solid and named, a proposal dashed", () => {
    const { edges } = toolchainGraph(
      { ...chain, integrations: [LINK] },
      [{ job: "deploy", tool: "nexus", kind: "notify", services: ["nexus-prod"] }],
      {},
      new Map(),
      METRICS,
      null,
    );
    expect(edges.map((edge) => edge.label)).toEqual(["push", "proposed notify"]);
    expect(edges[0]?.style?.strokeDasharray).toBeUndefined();
    expect(edges[1]?.style?.strokeDasharray).toBeDefined();
  });

  test("two types on the same link make a single edge", () => {
    const { edges } = toolchainGraph(
      {
        ...chain,
        integrations: [LINK, { ...LINK, kind: "notify" }],
      },
      [],
      {},
      new Map(),
      METRICS,
      null,
    );
    expect(edges.map((edge) => edge.label)).toEqual(["push, notify"]);
  });

  test("a proposed job without a service still appears in the graph", () => {
    const { nodes } = toolchainGraph(
      { services: [], integrations: [], dismissed: [] },
      [{ job: "scan", tool: "nexus", kind: "push", services: [] }],
      {},
      new Map(),
      METRICS,
      null,
    );
    expect(nodes.map((node) => node.id)).toEqual(["job:scan"]);
  });

  test("services follow their jobs, to avoid crossings", () => {
    const { nodes } = toolchainGraph(
      {
        services: [
          { ...NEXUS, id: "premier" },
          { ...NEXUS, id: "second" },
        ],
        integrations: [
          { job: "a", service: "second", kind: "push" },
          { job: "b", service: "premier", kind: "push" },
        ],
        dismissed: [],
      },
      [],
      {},
      new Map(),
      METRICS,
      null,
    );
    const y = (id: string) => nodes.find((node) => node.id === id)?.position.y ?? -1;
    expect(y("service:second")).toBeLessThan(y("service:premier"));
  });

  test("an integration to an unknown service has no dangling edge", () => {
    const { edges } = toolchainGraph(
      { services: [], integrations: [LINK], dismissed: [] },
      [],
      {},
      new Map(),
      METRICS,
      null,
    );
    expect(edges).toEqual([]);
  });
});
