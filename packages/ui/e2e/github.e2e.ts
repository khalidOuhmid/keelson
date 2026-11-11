import { expect, test } from "@playwright/test";
import { startKeelson, type Tree } from "./support/server.ts";

const WORKFLOW = `name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make
  secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: gitleaks/gitleaks-action@v2
  sast:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: github/codeql-action/analyze@v3
  deploy:
    runs-on: ubuntu-latest
    needs: [sast, secrets]
    environment: production
    steps:
      - run: ./deploy.sh
`;

const TREE: Tree = {
  ".gitlab-ci.yml": "compile:\n  stage: build\n  script:\n    - make\n",
  ".github/workflows/ci.yml": WORKFLOW,
};

test.describe("workflows GitHub Actions sur le binaire réel", () => {
  test("le sélecteur ouvre le workflow, rangé par niveau de dépendance", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await expect(page.getByRole("button", { name: /compile/ })).toBeVisible();

      await page
        .getByRole("combobox", { name: "CI file" })
        .selectOption(".github/workflows/ci.yml");
      await expect(page.getByTestId("read-only-tag")).toContainText("read-only");

      const columns = page.getByTestId("stage-column-name");
      await expect(columns).toHaveText([/level 1/, /level 2/, /level 3/]);

      const inColumn = async (job: string, stage: string) => {
        const node = await page.locator(`[data-job-id="${job}"]`).boundingBox();
        const column = await page.getByRole("group", { name: `Stage ${stage}` }).boundingBox();
        if (node === null || column === null) {
          return false;
        }
        return node.x >= column.x && node.x + node.width <= column.x + column.width;
      };
      for (const [job, stage] of [
        ["build", "level 1"],
        ["secrets", "level 1"],
        ["sast", "level 2"],
        ["deploy", "level 3"],
      ] as const) {
        expect(await inColumn(job, stage)).toBe(true);
      }

      await expect(page.getByRole("button", { name: "Add stage" })).toBeDisabled();
      expect(keelson.readAt(".github/workflows/ci.yml")).toBe(WORKFLOW);
    } finally {
      await keelson.stop();
    }
  });

  test("la couverture d'un workflow vient de ses actions", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page
        .getByRole("combobox", { name: "CI file" })
        .selectOption(".github/workflows/ci.yml");
      await page.getByRole("button", { name: "Coverage" }).click();
      await expect(page.locator('[data-job-id="secrets"]')).toContainText("Secrets");
      await expect(page.locator('[data-job-id="sast"]')).toContainText("SAST");
    } finally {
      await keelson.stop();
    }
  });
});
