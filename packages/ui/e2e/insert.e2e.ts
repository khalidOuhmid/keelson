import { expect, test } from "@playwright/test";
import { startKeelson, type Tree } from "./support/server.ts";

const TREE: Tree = {
  ".gitlab-ci.yml": [
    "stages:",
    "  - build",
    "",
    "compile:",
    "  stage: build",
    "  script:",
    "    - make",
    "",
  ].join("\n"),
};

test.describe("insertion sur le binaire réel", () => {
  test("d'une couche non couverte au job écrit, puis annulé d'un coup", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    const original = keelson.read();
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Coverage" }).click();
      await page
        .getByRole("group", { name: "Uncovered OWASP layers" })
        .getByRole("listitem")
        .filter({ hasText: "Secrets" })
        .getByRole("button", { name: "See tools" })
        .click();
      await page.getByRole("button", { name: "Gitleaks", exact: true }).click();
      await page.getByRole("button", { name: "Add to pipeline" }).click();

      const diff = page.getByTestId("insert-diff");
      await expect(diff).toContainText("+gitleaks:");
      await expect(page.getByTestId("insert-layers")).toContainText("Secrets");
      expect(keelson.read()).toBe(original);

      await page.getByRole("button", { name: "Insert" }).click();
      await expect(page.locator("[data-job-id=gitleaks]")).toBeVisible();
      await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
      expect(keelson.read()).toContain("gitleaks:\n  stage:");
      expect(keelson.read().split("\n").slice(0, 2).join("\n")).toContain("stages:");

      await page.getByRole("button", { name: "Undo" }).click();
      await expect(page.locator("[data-job-id=gitleaks]")).toHaveCount(0);
      expect(keelson.read()).toBe(original);
    } finally {
      await keelson.stop();
    }
  });

  test("un refus de nom coupe Insert et n'écrit rien", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    const original = keelson.read();
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Catalog" }).click();
      await page.getByRole("button", { name: "Gitleaks", exact: true }).click();
      await page.getByRole("button", { name: "Add to pipeline" }).click();
      await page.getByLabel("Job name").fill("compile");
      await expect(page.getByRole("alert")).toContainText("already exists");
      await expect(page.getByRole("button", { name: "Insert" })).toBeDisabled();
      expect(keelson.read()).toBe(original);
    } finally {
      await keelson.stop();
    }
  });
});
