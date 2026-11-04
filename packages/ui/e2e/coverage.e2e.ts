import { expect, test } from "@playwright/test";
import { startKeelson, type Tree } from "./support/server.ts";

const TREE: Tree = {
  ".gitlab-ci.yml": [
    "include: /ci/scan.yml",
    "",
    "stages:",
    "  - build",
    "  - test",
    "",
    "compile:",
    "  stage: build",
    "  script:",
    "    - make",
    "",
    "secrets:",
    "  stage: test",
    "  image: ghcr.io/gitleaks/gitleaks:latest",
    "  script:",
    "    - gitleaks git",
    "",
  ].join("\n"),
  "ci/scan.yml": "sast:\n  stage: test\n  script:\n    - semgrep ci\n",
};

test.describe("couverture sur le binaire réel", () => {
  test("la vue Coverage retire l'édition et étiquette les jobs", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await expect(page.getByRole("group", { name: "Stages" })).toBeVisible();

      await page.getByRole("button", { name: "Coverage" }).click();

      await expect(page.getByRole("group", { name: "Stages" })).toHaveCount(0);
      await expect(page.getByTestId("coverage-count")).toHaveText("2 of 21 layers covered");
      await expect(page.locator('[data-job-id="secrets"]')).toContainText("Secrets");
      // Détecté à travers un include, sur une ligne de script.
      await expect(page.locator('[data-job-id="sast"]')).toContainText("SAST");
      await expect(page.locator('[data-job-id="compile"]')).not.toContainText("SAST");

      await page.locator('[data-job-id="compile"]').click();
      await expect(page.getByRole("region", { name: "Job detail" })).toBeVisible();
      await expect(page.getByRole("group", { name: "Job editor" })).toHaveCount(0);
    } finally {
      await keelson.stop();
    }
  });

  test("choisir une couche met ses jobs en avant", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Coverage" }).click();
      await page.getByRole("button", { name: /Static analysis/ }).click();
      await expect(page.locator('[data-job-id="sast"]')).toHaveAttribute("data-emphasised", "true");
      await expect(page.locator('[data-job-id="secrets"]')).toHaveAttribute(
        "data-emphasised",
        "false",
      );
    } finally {
      await keelson.stop();
    }
  });

  test("depuis une couche non couverte, le catalogue filtré puis la fiche", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Coverage" }).click();

      const row = page
        .getByRole("region", { name: "Uncovered layers" })
        .getByRole("listitem")
        .filter({ hasText: "Dynamic testing" });
      await row.getByRole("button", { name: "See tools" }).click();

      await expect(page.getByLabel("Layer")).toHaveValue("dast");
      await page.getByRole("button", { name: /^ZAP/ }).click();

      const card = page.getByRole("region", { name: "Tool detail" });
      await expect(card.getByTestId("tool-license")).toHaveText("Apache-2.0 · open source");
      await expect(card).toContainText("zap-baseline.py");
    } finally {
      await keelson.stop();
    }
  });

  test("une surcharge de layout.json se voit sans recharger", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Coverage" }).click();
      await expect(page.getByTestId("coverage-count")).toHaveText("2 of 21 layers covered");

      keelson.writeAt(".devsecops/layout.json", '{"version":1,"layers":{"compile":["iast"]}}');

      await expect(page.getByTestId("coverage-count")).toHaveText("3 of 21 layers covered", {
        timeout: 10_000,
      });
    } finally {
      await keelson.stop();
    }
  });

  test("à 375 px, la sélection ouvre le panneau dans la fenêtre", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await expect(page.getByRole("group", { name: "Stages" })).toBeHidden();

      await page.getByRole("button", { name: "Panel" }).click();
      await expect(page.getByRole("group", { name: "Stages" })).toBeInViewport();
      await page.getByRole("button", { name: "Close panel" }).click();

      await page.locator('[data-job-id="compile"]').click({ force: true });
      await expect(page.getByRole("region", { name: "Job detail" })).toBeInViewport();
    } finally {
      await keelson.stop();
    }
  });
});
