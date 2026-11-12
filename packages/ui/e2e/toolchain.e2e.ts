import { expect, test } from "@playwright/test";
import { startKeelson, type Tree } from "./support/server.ts";

const TREE: Tree = {
  ".gitlab-ci.yml": [
    "stages:",
    "  - build",
    "  - deploy",
    "",
    "build:",
    "  stage: build",
    "  script:",
    "    - curl -T app.jar https://nexus.example.org/repo/app.jar",
    "",
    "deploy:",
    "  stage: deploy",
    "  script:",
    "    - vault kv get secret/app",
    "",
  ].join("\n"),
};

const TOOLCHAIN = ".devsecops/toolchain.yaml";

test.describe("toolchain on the real binary", () => {
  test("confirming an inference writes the file, undo restores it", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();

      const proposals = page.getByRole("group", { name: "Proposed integrations" });
      await expect(proposals.getByText("HashiCorp Vault")).toBeVisible();
      await page.getByRole("button", { name: "Add a service for deploy, HashiCorp Vault" }).click();
      await expect(page.getByLabel("Name")).toBeFocused();
      await expect(page.getByRole("combobox", { name: "Tool", exact: true })).toHaveValue("vault");
      await page
        .getByRole("group", { name: "New service" })
        .getByRole("button", { name: "Add service" })
        .click();

      await page.getByRole("button", { name: "Confirm fetch-secret from deploy to vault" }).click();
      await expect
        .poll(() => keelson.readAt(TOOLCHAIN))
        .toContain("  - job: deploy\n    service: vault\n");
      await expect(page.locator(".react-flow__edge")).toHaveCount(1);
      await expect(proposals.getByText("HashiCorp Vault")).toHaveCount(0);

      await page.getByRole("button", { name: "Undo" }).click();
      await expect(proposals.getByText("HashiCorp Vault")).toBeVisible();
      expect(keelson.readAt(TOOLCHAIN)).not.toContain("job: deploy");
    } finally {
      await keelson.stop();
    }
  });

  test("dismissing a proposal removes it, and the file keeps that", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      await page.getByRole("button", { name: /^Dismiss fetch-secret/ }).click();
      await expect(page.getByRole("group", { name: "Dismissed" })).toBeVisible();
      expect(keelson.readAt(TOOLCHAIN)).toContain("dismissed:");
    } finally {
      await keelson.stop();
    }
  });

  test("a moved position survives a reload", async ({ page }) => {
    const keelson = await startKeelson({
      ...TREE,
      [TOOLCHAIN]: "version: 1\nservices:\n  vault:\n    tool: vault\n",
    });
    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      const node = page.locator("[data-service-id=vault]");
      const before = await node.boundingBox();
      if (before === null) {
        throw new Error("node missing");
      }
      await page.mouse.move(before.x + 20, before.y + 20);
      await page.mouse.down();
      await page.mouse.move(before.x - 120, before.y + 110, { steps: 8 });
      await page.mouse.up();

      await expect
        .poll(() => {
          try {
            return JSON.parse(keelson.readAt(".devsecops/layout.json")).positions;
          } catch {
            return {};
          }
        })
        .toHaveProperty(["service:vault"]);
      const saved = JSON.parse(keelson.readAt(".devsecops/layout.json")).positions["service:vault"];

      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      await expect(page.locator("[data-service-id=vault]")).toBeVisible();
      const transform = await page
        .locator(".react-flow__node-service")
        .evaluate((element) => (element as HTMLElement).style.transform);
      const shown = Number.parseFloat(transform.slice("translate(".length));
      expect(shown).toBeCloseTo(saved.x, 2);
    } finally {
      await keelson.stop();
    }
  });

  test("an external write shows without reloading", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      await expect(page.getByText("No services declared yet.").first()).toBeVisible();
      keelson.writeAt(TOOLCHAIN, "version: 1\nservices:\n  nexus:\n    tool: nexus\n");
      await expect(
        page.getByRole("group", { name: "Services" }).getByRole("button", { name: /nexus/ }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    } finally {
      await keelson.stop();
    }
  });

  test("an invalid file disables editing and says so", async ({ page }) => {
    const keelson = await startKeelson({ ...TREE, [TOOLCHAIN]: "version: 2\n" });
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      await expect(page.getByText("TOOLCHAIN_INVALID").first()).toBeVisible();
      await expect(page.getByText("toolchain.yaml can't be read.").first()).toBeVisible();
      await expect(page.getByRole("group", { name: "New service" })).toHaveCount(0);
    } finally {
      await keelson.stop();
    }
  });

  test("Backspace removes no node from the screen", async ({ page }) => {
    const keelson = await startKeelson({
      ...TREE,
      [TOOLCHAIN]: "version: 1\nservices:\n  vault:\n    tool: vault\n",
    });
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      await page.locator("[data-toolchain-job=deploy]").click();
      await page.keyboard.press("Backspace");
      await expect(page.locator("[data-toolchain-job=deploy]")).toBeVisible();
    } finally {
      await keelson.stop();
    }
  });

  test("Escape closes the service panel and returns focus to the graph", async ({ page }) => {
    const keelson = await startKeelson({
      ...TREE,
      [TOOLCHAIN]: "version: 1\nservices:\n  vault:\n    tool: vault\n",
    });
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      await page.locator("[data-service-id=vault]").click();
      await expect(page.getByRole("region", { name: "Service detail" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("region", { name: "Service detail" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Toolchain graph" })).toBeFocused();
    } finally {
      await keelson.stop();
    }
  });

  test("at 375 px, the Panel button counts pending decisions", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      await expect(page.getByRole("button", { name: "Panel, 2 proposed" })).toBeVisible();
    } finally {
      await keelson.stop();
    }
  });

  test("an input in progress survives an unrelated write", async ({ page }) => {
    const keelson = await startKeelson({
      ...TREE,
      [TOOLCHAIN]: "version: 1\nservices:\n  vault:\n    tool: vault\n",
    });
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      await page.locator("[data-service-id=vault]").click();
      const panel = page.getByRole("region", { name: "Service detail" });
      await panel.getByRole("textbox", { name: "URL" }).fill("http://brouillon");
      await panel.getByRole("button", { name: "Add integration" }).click();
      await expect(panel.getByRole("button", { name: /^Remove push|^Remove fetch/ })).toBeVisible();
      await expect(panel.getByRole("textbox", { name: "URL" })).toHaveValue("http://brouillon");
    } finally {
      await keelson.stop();
    }
  });

  test("a service removed externally does not steal focus from an input", async ({ page }) => {
    const keelson = await startKeelson({
      ...TREE,
      [TOOLCHAIN]: "version: 1\nservices:\n  vault:\n    tool: vault\n",
    });
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      await page.locator("[data-service-id=vault]").click();
      const name = page.getByRole("textbox", { name: "Name" });
      await name.fill("mon-depot");
      keelson.writeAt(TOOLCHAIN, "version: 1\n");
      await expect(page.getByRole("region", { name: "Service detail" })).toHaveCount(0);
      await expect(name).toBeFocused();
    } finally {
      await keelson.stop();
    }
  });

  test("removing the selected service returns focus to the graph", async ({ page }) => {
    const keelson = await startKeelson({
      ...TREE,
      [TOOLCHAIN]: "version: 1\nservices:\n  vault:\n    tool: vault\n",
    });
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      await page.locator("[data-service-id=vault]").click();
      await page.getByRole("button", { name: "Remove service" }).click();
      await expect(page.getByRole("region", { name: "Toolchain graph" })).toBeFocused();
    } finally {
      await keelson.stop();
    }
  });

  test("Save by the keyboard keeps focus on Save once written", async ({ page }) => {
    const keelson = await startKeelson({
      ...TREE,
      [TOOLCHAIN]: "version: 1\nservices:\n  vault:\n    tool: vault\n",
    });
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      await page.locator("[data-service-id=vault]").click();
      const panel = page.getByRole("region", { name: "Service detail" });
      await panel.getByRole("textbox", { name: "URL" }).fill("https://vault.example.org");
      await panel.getByRole("button", { name: "Save" }).focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => keelson.readAt(TOOLCHAIN)).toContain("https://vault.example.org");
      await expect(panel.getByRole("button", { name: "Save" })).toBeEnabled();
      await expect(panel.getByRole("button", { name: "Save" })).toBeFocused();
    } finally {
      await keelson.stop();
    }
  });

  test("Enter in a service field keeps focus on that field once written", async ({ page }) => {
    const keelson = await startKeelson({
      ...TREE,
      [TOOLCHAIN]: "version: 1\nservices:\n  vault:\n    tool: vault\n",
    });
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      await page.locator("[data-service-id=vault]").click();
      const panel = page.getByRole("region", { name: "Service detail" });
      await panel.getByRole("textbox", { name: "Environment" }).fill("production");
      await page.keyboard.press("Enter");
      await expect.poll(() => keelson.readAt(TOOLCHAIN)).toContain("environment: production");
      await expect(panel.getByRole("textbox", { name: "Environment" })).toBeEnabled();
      await expect(panel.getByRole("textbox", { name: "Environment" })).toBeFocused();
    } finally {
      await keelson.stop();
    }
  });

  test("Add integration by the keyboard keeps focus on it once written", async ({ page }) => {
    const keelson = await startKeelson({
      ...TREE,
      [TOOLCHAIN]: "version: 1\nservices:\n  vault:\n    tool: vault\n",
    });
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      await page.locator("[data-service-id=vault]").click();
      const panel = page.getByRole("region", { name: "Service detail" });
      await panel.getByRole("button", { name: "Add integration" }).focus();
      await page.keyboard.press("Enter");
      await expect(panel.getByRole("button", { name: /^Remove / })).toBeVisible();
      await expect(panel.getByRole("button", { name: "Add integration" })).toBeEnabled();
      await expect(panel.getByRole("button", { name: "Add integration" })).toBeFocused();
    } finally {
      await keelson.stop();
    }
  });

  test("opening a service keeps the zoom the user chose", async ({ page }) => {
    const keelson = await startKeelson({
      ...TREE,
      [TOOLCHAIN]: "version: 1\nservices:\n  vault:\n    tool: vault\n",
    });
    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      const graph = page.getByRole("region", { name: "Toolchain graph" });
      const viewport = graph.locator(".react-flow__viewport");
      await expect(page.locator("[data-service-id=vault]")).toBeVisible();
      await graph.getByRole("button", { name: "Zoom Out" }).click();
      await graph.getByRole("button", { name: "Zoom Out" }).click();
      await expect.poll(() => viewport.getAttribute("style")).toMatch(/scale\(/);
      const zoomed = await viewport.getAttribute("style");
      await page.locator("[data-service-id=vault]").click();
      await expect(page.getByRole("region", { name: "Service detail" })).toBeVisible();
      await page.waitForTimeout(300);
      expect(await viewport.getAttribute("style")).toBe(zoomed);
    } finally {
      await keelson.stop();
    }
  });

  test("Fit View brings every node back on the canvas", async ({ page }) => {
    const keelson = await startKeelson({
      ...TREE,
      [TOOLCHAIN]: "version: 1\nservices:\n  vault:\n    tool: vault\n",
    });
    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      const graph = page.getByRole("region", { name: "Toolchain graph" });
      await graph.getByRole("button", { name: "Zoom In" }).click();
      await graph.hover();
      await page.mouse.wheel(2000, 2000);
      await expect(page.locator("[data-service-id=vault]")).not.toBeInViewport();
      await graph.getByRole("button", { name: "Fit View" }).click();
      for (const node of await page.locator(".react-flow__node").all()) {
        await expect(node).toBeInViewport({ ratio: 1 });
      }
    } finally {
      await keelson.stop();
    }
  });

  test("the canvas controls take their colours from the design tokens", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      const graph = page.getByRole("region", { name: "Toolchain graph" });
      await expect(graph.locator(".react-flow")).toHaveClass(/\bdark\b/);
      const button = graph.getByRole("button", { name: "Fit View" });
      const colours = await button.evaluate((element) => {
        const probe = document.createElement("div");
        probe.style.background = "var(--color-surface-2)";
        probe.style.color = "var(--color-text-secondary)";
        probe.style.borderColor = "var(--color-border-default)";
        document.body.append(probe);
        const expected = getComputedStyle(probe);
        const actual = getComputedStyle(element);
        const result = {
          background: [actual.backgroundColor, expected.backgroundColor],
          color: [actual.color, expected.color],
        };
        probe.remove();
        return result;
      });
      expect(colours.background[0]).toBe(colours.background[1]);
      expect(colours.color[0]).toBe(colours.color[1]);
    } finally {
      await keelson.stop();
    }
  });

  test("at 375 px, the toolchain overlays keep Tab inside them", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const keelson = await startKeelson({
      ...TREE,
      [TOOLCHAIN]: "version: 1\nservices:\n  vault:\n    tool: vault\n",
    });
    const inside = (selector: string) =>
      page.evaluate(
        (query) => document.querySelector(query)?.contains(document.activeElement),
        selector,
      );
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      await page.getByRole("button", { name: /^Panel/ }).click();
      await expect(page.getByRole("button", { name: "Close panel" })).toBeFocused();
      for (let step = 0; step < 16; step += 1) {
        await page.keyboard.press("Tab");
        expect(await inside('aside[aria-label="Toolchain"]')).toBe(true);
      }
      await page.getByRole("button", { name: "Close panel" }).click();

      await page.locator("[data-service-id=vault]").click();
      await expect(page.getByRole("region", { name: "Service detail" })).toBeVisible();
      for (let step = 0; step < 16; step += 1) {
        await page.keyboard.press("Tab");
        expect(await inside('aside[aria-label="Service"]')).toBe(true);
      }
    } finally {
      await keelson.stop();
    }
  });

  test("at 375 px, New service is collapsed until asked for", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      await page.getByRole("button", { name: /^Panel/ }).click();
      const toggle = page.getByRole("button", { name: "New service" });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("textbox", { name: "Name" })).toHaveCount(0);

      await page.getByRole("button", { name: "Add a service for deploy, HashiCorp Vault" }).click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("textbox", { name: "Name" })).toBeFocused();

      await toggle.click();
      await expect(page.getByRole("textbox", { name: "Name" })).toHaveCount(0);
    } finally {
      await keelson.stop();
    }
  });

  test("from lg up, New service is open", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      await expect(page.getByRole("button", { name: "New service" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await expect(page.getByRole("textbox", { name: "Name" })).toBeVisible();
    } finally {
      await keelson.stop();
    }
  });

  test("at 375 px, the service panel fits in the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const keelson = await startKeelson({
      ...TREE,
      [TOOLCHAIN]: "version: 1\nservices:\n  vault:\n    tool: vault\n",
    });
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Toolchain" }).click();
      await page.locator("[data-service-id=vault]").click();
      await expect(page.getByRole("region", { name: "Service detail" })).toBeInViewport();
    } finally {
      await keelson.stop();
    }
  });
});
