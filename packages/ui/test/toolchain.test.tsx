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
    detect: { images: [], scripts: [] },
    snippets: { gitlab: null, github: null },
    lastVerified: "2026-11-04",
  };
}

const TOOLS = [tool("nexus"), tool("vault", "fetch-secret")];
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

describe("panneau de toolchain", () => {
  test("rien à confirmer, aucun service : les deux états le disent", () => {
    panel(payload());
    expect(screen.getByText("Nothing to confirm.")).toBeDefined();
    expect(screen.getAllByText("No services declared yet.")).toHaveLength(1);
  });

  test("confirmer une proposition envoie l'intégration", async () => {
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

  test("avec deux services candidats, le choix vaut pour la confirmation", async () => {
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

  test("écarter une proposition", async () => {
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

  test("sans service, la proposition pré-remplit le formulaire", async () => {
    panel(
      payload({
        proposed: [{ job: "b", tool: "vault", kind: "fetch-secret", services: [] }],
      }),
    );
    const list = screen.getByRole("group", { name: "Proposed integrations" });
    await userEvent.click(within(list).getByRole("button", { name: "Add service" }));
    expect((screen.getByLabelText("Tool") as HTMLSelectElement).value).toBe("vault");
  });

  test("ajouter un service, le nom retombe sur l'outil", async () => {
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

  test("une proposition écartée se rétablit, et la section n'existe que si elle sert", async () => {
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

  test("un service se sélectionne au clavier depuis la liste", async () => {
    const { onSelectService } = panel(payload({ toolchain: { services: [NEXUS] } }));
    await userEvent.click(screen.getByRole("button", { name: /nexus-prod/ }));
    expect(onSelectService).toHaveBeenCalledWith("nexus-prod");
  });
});

describe("panneau de service", () => {
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

  test("retirer est refusé d'avance, avec la raison, tant qu'un job y est relié", () => {
    service(true);
    expect(
      (screen.getByRole("button", { name: "Remove service" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("Still used by build.")).toBeDefined();
  });

  test("enregistrer vide un champ par null", async () => {
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

  test("ajouter une intégration à la main, le type de la fiche par défaut", async () => {
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

  test("retirer une intégration", async () => {
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

describe("graphe", () => {
  const METRICS = { nodeWidth: 200, nodeHeight: 60, columnGap: 50, rowGap: 20 };
  const LINK = { job: "build", service: "nexus-prod", kind: "push" } as const;
  const chain = { services: [NEXUS], integrations: [LINK], dismissed: [] };

  test("deux colonnes sans position enregistrée", () => {
    const { nodes } = toolchainGraph(chain, [], {}, new Map(), METRICS, null);
    expect(nodes.map((node) => [node.id, node.position])).toEqual([
      ["job:build", { x: 0, y: 0 }],
      ["service:nexus-prod", { x: 350, y: 0 }],
    ]);
  });

  test("une position enregistrée gagne", () => {
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

  test("une intégration est pleine et nommée, une proposition pointillée", () => {
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

  test("une intégration vers un service inconnu n'a pas d'arête dans le vide", () => {
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
