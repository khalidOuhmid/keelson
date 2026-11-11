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

test.describe("insertion on the real binary", () => {
  test("from an uncovered layer to the written job, then undone in one step", async ({ page }) => {
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

      await page.getByRole("button", { name: "Insert into .gitlab-ci.yml" }).click();
      await expect(page.locator("[data-job-id=gitleaks]")).toBeFocused();
      await expect(page.getByRole("status").filter({ hasText: "gitleaks added" })).toBeVisible();
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

  test("at 375 px, the insertion feedback leaves Undo and the node reachable", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Catalog" }).click();
      await page.getByRole("button", { name: "Gitleaks", exact: true }).click();
      await page.getByRole("button", { name: "Add to pipeline" }).click();
      await page.getByRole("button", { name: "Insert into .gitlab-ci.yml" }).click();
      await expect(page.locator("[data-job-id=gitleaks]")).toBeAttached();
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(page.locator("[data-job-id=gitleaks]")).toHaveCount(0);
    } finally {
      await keelson.stop();
    }
  });

  test("a rejected name disables Insert and writes nothing", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    const original = keelson.read();
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Catalog" }).click();
      await page.getByRole("button", { name: "Gitleaks", exact: true }).click();
      await page.getByRole("button", { name: "Add to pipeline" }).click();
      await page.getByLabel("Job name").fill("compile");
      await expect(page.getByRole("alert")).toContainText("already exists");
      await expect(page.getByRole("button", { name: "Insert into .gitlab-ci.yml" })).toBeDisabled();
      expect(keelson.read()).toBe(original);
    } finally {
      await keelson.stop();
    }
  });
});
