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

test.describe("toolchain sur le binaire réel", () => {
  test("confirmer une inférence écrit le fichier, annuler le rend", async ({ page }) => {
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
      await expect(page.locator(".react-flow__edge")).toHaveCount(1);
      expect(keelson.readAt(TOOLCHAIN)).toContain("  - job: deploy\n    service: vault\n");
      await expect(proposals.getByText("HashiCorp Vault")).toHaveCount(0);

      await page.getByRole("button", { name: "Undo" }).click();
      await expect(proposals.getByText("HashiCorp Vault")).toBeVisible();
      expect(keelson.readAt(TOOLCHAIN)).not.toContain("job: deploy");
    } finally {
      await keelson.stop();
    }
  });

  test("écarter une proposition la retire, et le fichier le garde", async ({ page }) => {
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

  test("une position déplacée survit au rechargement", async ({ page }) => {
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
        throw new Error("nœud absent");
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

  test("une écriture externe se voit sans recharger", async ({ page }) => {
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

  test("un fichier invalide coupe l'édition et le dit", async ({ page }) => {
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

  test("Retour arrière ne retire aucun nœud de l'écran", async ({ page }) => {
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

  test("Échap ferme le panneau de service et rend le focus au graphe", async ({ page }) => {
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

  test("à 375 px, le bouton Panel compte les décisions en attente", async ({ page }) => {
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

  test("à 375 px, le panneau de service tient dans la fenêtre", async ({ page }) => {
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
