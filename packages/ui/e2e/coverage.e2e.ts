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

test.describe("coverage on the real binary", () => {
  test("the Coverage view removes editing and labels jobs", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await expect(page.getByRole("group", { name: "Stages" })).toBeVisible();

      await page.getByRole("button", { name: "Coverage" }).click();

      await expect(page.getByRole("group", { name: "Stages" })).toHaveCount(0);
      await expect(page.getByTestId("coverage-count")).toHaveText(
        "2 of 13 OWASP layers covered, 1 of 8 platform categories seen",
      );
      await expect(
        page.getByRole("group", { name: "Covered layers" }).getByRole("button", {
          name: /Source control/,
        }),
      ).toContainText("ci gitlab-ci");
      await expect(page.locator('[data-job-id="secrets"]')).toContainText("Secrets");
      // Detected through an include, on a script line.
      await expect(page.locator('[data-job-id="sast"]')).toContainText("SAST");
      await expect(page.locator('[data-job-id="compile"]')).not.toContainText("SAST");

      await page.locator('[data-job-id="compile"]').click();
      await expect(page.getByRole("region", { name: "Job detail" })).toBeVisible();
      await expect(page.getByRole("group", { name: "Job editor" })).toHaveCount(0);
    } finally {
      await keelson.stop();
    }
  });

  test("choosing a layer highlights its jobs", async ({ page }) => {
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

  test("from an uncovered layer, the filtered catalogue then the entry", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Coverage" }).click();

      const row = page
        .getByRole("group", { name: "Uncovered OWASP layers" })
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

  test("a layout.json override shows without reloading", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Coverage" }).click();
      await expect(page.getByTestId("coverage-count")).toHaveText(
        "2 of 13 OWASP layers covered, 1 of 8 platform categories seen",
      );

      keelson.writeAt(".devsecops/layout.json", '{"version":1,"layers":{"compile":["iast"]}}');

      await expect(page.getByTestId("coverage-count")).toHaveText(
        "3 of 13 OWASP layers covered, 1 of 8 platform categories seen",
        {
          timeout: 10_000,
        },
      );
    } finally {
      await keelson.stop();
    }
  });

  test("a partial pipeline is stated once, and coverage becomes a lower bound", async ({
    page,
  }) => {
    const keelson = await startKeelson({
      ...TREE,
      ".gitlab-ci.yml": `include:\n  - /ci/scan.yml\n  - template: Jobs/SAST.gitlab-ci.yml\n\n${TREE[".gitlab-ci.yml"]?.split("\n").slice(2).join("\n")}`,
    });
    try {
      await page.goto(keelson.url);
      await expect(page.getByRole("group", { name: "Partial pipeline" })).toBeVisible();
      await expect(page.getByText("INCLUDE_UNRESOLVED")).toHaveCount(0);

      await page.getByRole("button", { name: "Coverage" }).click();
      await expect(page.getByTestId("coverage-lower-bound")).toContainText(
        "Coverage is a lower bound",
      );
    } finally {
      await keelson.stop();
    }
  });

  test("changing layout.json keeps history and announces nothing", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByLabel("New stage name").fill("livrer");
      await page.getByRole("button", { name: "Add stage" }).click();
      await expect(page.getByRole("button", { name: /Undo/ })).toBeEnabled();

      keelson.writeAt(".devsecops/layout.json", '{"version":1,"layers":{"compile":["iast"]}}');
      await page.getByRole("button", { name: "Coverage" }).click();
      await expect(page.getByTestId("coverage-count")).toContainText("3 of 13", {
        timeout: 10_000,
      });
      await expect(page.getByText("The file changed on disk")).toHaveCount(0);

      await page.getByRole("button", { name: "Pipeline" }).click();
      await expect(page.getByRole("button", { name: /Undo/ })).toBeEnabled();
    } finally {
      await keelson.stop();
    }
  });

  test("the read view writes nothing, even on Ctrl+Z", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByLabel("New stage name").fill("livrer");
      await page.getByRole("button", { name: "Add stage" }).click();
      await expect.poll(() => keelson.read()).toContain("livrer");
      const written = keelson.read();

      await page.getByRole("button", { name: "Coverage" }).click();
      await expect(page.getByRole("button", { name: /Undo/ })).toHaveCount(0);
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(300);
      expect(keelson.read()).toBe(written);
    } finally {
      await keelson.stop();
    }
  });

  test("catalogue columns stay labelled while scrolling", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Catalog" }).click();
      const table = page.getByRole("table");
      await table.getByRole("button", { name: "ZAP" }).scrollIntoViewIfNeeded();

      const header = table.getByRole("columnheader", { name: "Tool" });
      const list = await table.locator("..").boundingBox();
      const cell = await header.boundingBox();
      expect(cell?.y).toBeGreaterThanOrEqual(list?.y ?? Number.POSITIVE_INFINITY);
    } finally {
      await keelson.stop();
    }
  });

  test("at 375 px, the header fits in the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await expect(page.getByRole("button", { name: "Catalog" })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBe(0);

      await page.getByRole("button", { name: "Catalog" }).click();
      await page.getByRole("button", { name: /^ZAP/ }).scrollIntoViewIfNeeded();
      await expect(page.getByLabel("Layer")).toBeInViewport();
      await expect(page.getByLabel("Adapter")).toBeInViewport();
      const name = await page.getByRole("button", { name: /^ZAP/ }).boundingBox();
      expect(name?.width).toBeGreaterThanOrEqual(100);
    } finally {
      await keelson.stop();
    }
  });

  test("a job's panel says what decided its layers", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Coverage" }).click();
      await page.locator('[data-job-id="sast"]').click();
      await expect(page.getByTestId("job-layers-source")).toHaveText("Detected from semgrep.");
    } finally {
      await keelson.stop();
    }
  });

  test("at 375 px, selection opens the panel inside the viewport", async ({ page }) => {
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
