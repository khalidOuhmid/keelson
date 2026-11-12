import { afterEach, describe, expect, test } from "bun:test";
import type { Tool } from "@keelson/catalog";
import { LAYERS } from "@keelson/taxonomy";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { focusWhenDrawn } from "../src/focus.ts";
import { CatalogView } from "../src/views/catalog/CatalogView.tsx";
import { narrowViewport, restoreViewport } from "./support/viewport.ts";

afterEach(() => {
  cleanup();
  restoreViewport();
});

function tool(id: string, name: string): Tool {
  return {
    id,
    name,
    kind: "job",
    layers: ["sast"],
    license: "MIT",
    homepage: "https://example.org/",
    verifiedAt: "https://example.org/verified",
    logo: null,
    detect: { images: [], scripts: [], actions: [] },
    snippets: { gitlab: null, github: null },
    lastVerified: "2026-11-04",
    integration: null,
  };
}

function renderCatalog() {
  render(
    <CatalogView
      catalog={{ layers: [...LAYERS], tools: [tool("a", "Alpha"), tool("b", "Beta")], logos: {} }}
      initialLayer={null}
    />,
  );
}

describe("the catalogue entry", () => {
  test("Close returns focus to the tool row that opened it", async () => {
    renderCatalog();
    await userEvent.click(screen.getByRole("button", { name: "Beta" }));
    await userEvent.click(screen.getByRole("button", { name: "Close tool detail" }));

    expect(screen.queryByRole("region", { name: "Tool detail" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Beta" }));
  });

  test("Escape closes it and returns focus to the row", async () => {
    renderCatalog();
    await userEvent.click(screen.getByRole("button", { name: "Alpha" }));
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("region", { name: "Tool detail" })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Alpha" }));
  });

  test("below lg, opening it moves focus into the overlay and Tab stays there", async () => {
    narrowViewport();
    renderCatalog();
    await userEvent.click(screen.getByRole("button", { name: "Alpha" }));

    const overlay = screen.getByRole("complementary", { name: "Tool" });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Close tool detail" }),
      ),
    );
    for (let step = 0; step < 6; step += 1) {
      await userEvent.tab();
      expect(overlay.contains(document.activeElement)).toBe(true);
    }
  });

  test("from lg up, opening it leaves focus on the row", async () => {
    renderCatalog();
    await userEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Alpha" }));
  });
});

describe("focusing what was just drawn", () => {
  test("a graph node is focused without scrolling: the graph pans to it, the browser must not", () => {
    render(
      <div className="react-flow">
        <button type="button" data-job-id="gitleaks">
          gitleaks
        </button>
      </div>,
    );
    const node = screen.getByRole("button", { name: "gitleaks" });
    const options: (FocusOptions | undefined)[] = [];
    const focus = node.focus.bind(node);
    node.focus = (given?: FocusOptions) => {
      options.push(given);
      focus(given);
    };
    focusWhenDrawn('[data-job-id="gitleaks"]');
    expect(document.activeElement).toBe(node);
    expect(options).toEqual([{ preventScroll: true }]);
  });

  test("a field outside the graph is scrolled into view as usual", () => {
    render(<select aria-label="Layer" />);
    const field = screen.getByRole("combobox", { name: "Layer" });
    const options: (FocusOptions | undefined)[] = [];
    const focus = field.focus.bind(field);
    field.focus = (given?: FocusOptions) => {
      options.push(given);
      focus(given);
    };
    focusWhenDrawn('[aria-label="Layer"]');
    expect(options).toEqual([undefined]);
  });
});
