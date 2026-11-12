import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ToolchainPayload } from "../../src/api/client.ts";
import { LAYOUT_TOKENS } from "../../src/views/pipeline/metrics.ts";
import { ToolchainCanvas } from "../../src/views/toolchain/ToolchainCanvas.tsx";

beforeEach(() => {
  document.documentElement.style.setProperty(LAYOUT_TOKENS.nodeWidth, "200px");
  document.documentElement.style.setProperty(LAYOUT_TOKENS.nodeHeight, "64px");
  document.documentElement.style.setProperty(LAYOUT_TOKENS.columnGap, "72px");
  document.documentElement.style.setProperty(LAYOUT_TOKENS.rowGap, "20px");
});

afterEach(cleanup);

const MOVED = { "service:nexus": { x: 900, y: 700 } };

function payload(positions: ToolchainPayload["positions"]): ToolchainPayload {
  return {
    text: "",
    hash: "a",
    diagnostics: [],
    proposed: [],
    positions,
    toolchain: {
      services: [{ id: "nexus", tool: "nexus", url: null, environment: null }],
      integrations: [],
      dismissed: [],
    },
  };
}

function canvas(value: ToolchainPayload, invalid = false) {
  const onResetLayout = mock(() => {});
  const props = {
    labels: new Map(),
    selectedService: null,
    onSelectService: () => {},
    onMove: () => {},
    onResetLayout,
    invalid,
  };
  const view = render(<ToolchainCanvas payload={value} {...props} />);
  return {
    onResetLayout,
    rerender: (next: ToolchainPayload) =>
      view.rerender(<ToolchainCanvas payload={next} {...props} />),
  };
}

const transformOf = (): string =>
  document.querySelector<HTMLElement>(".react-flow__node-service")?.style.transform ?? "";

describe("reset layout", () => {
  test("nothing saved, nothing to reset", () => {
    canvas(payload({}));
    expect(screen.queryByRole("button", { name: "Reset layout" })).toBeNull();
  });

  test("an unreadable toolchain offers no reset: editing is off", () => {
    canvas(payload(MOVED), true);
    expect(screen.queryByRole("button", { name: "Reset layout" })).toBeNull();
  });

  test("asks before resetting, then resets", async () => {
    const { onResetLayout } = canvas(payload(MOVED));
    await userEvent.click(screen.getByRole("button", { name: "Reset layout" }));
    const dialog = screen.getByRole("alertdialog", { name: "Reset layout" });
    expect(dialog.textContent).toContain("every node");
    expect(document.activeElement?.textContent).toBe("Reset positions");
    await userEvent.click(screen.getByRole("button", { name: "Reset positions" }));
    expect(onResetLayout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  test("cancelling resets nothing and gives focus back", async () => {
    const { onResetLayout } = canvas(payload(MOVED));
    await userEvent.click(screen.getByRole("button", { name: "Reset layout" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onResetLayout).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reset layout" }));
  });

  test("Escape cancels", async () => {
    const { onResetLayout } = canvas(payload(MOVED));
    await userEvent.click(screen.getByRole("button", { name: "Reset layout" }));
    await userEvent.keyboard("{Escape}");
    expect(onResetLayout).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  test("once the positions are cleared, the node is back at its default place", () => {
    const { rerender } = canvas(payload(MOVED));
    expect(transformOf()).toContain("translate(900px,700px)");
    rerender(payload({}));
    expect(transformOf()).not.toContain("900px");
    expect(screen.queryByRole("button", { name: "Reset layout" })).toBeNull();
  });
});
