import { expect, test } from "@playwright/test";
import { startKeelson, type Tree } from "./support/server.ts";

const CI = ".github/workflows/ci.yml";
const REL = ".github/workflows/release.yml";

const TREE: Tree = {
  [CI]: [
    "name: CI",
    "on: push",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: make",
    "  test:",
    "    needs: build",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: make check",
    "",
  ].join("\n"),
  [REL]: [
    "on: push",
    "jobs:",
    "  publish:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: gitleaks/gitleaks-action@v2",
    "  shared:",
    "    uses: acme/ci/.github/workflows/scan.yml@v1",
    "",
  ].join("\n"),
};

test.describe("GitHub Actions sur le binaire réel", () => {
  test("sans .gitlab-ci.yml : les workflows s'ouvrent, niveaux dérivés", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await expect(page.locator("[data-job-id=build]")).toBeVisible();
      await expect(page.getByText("level 2").first()).toBeVisible();
      await expect(page.getByRole("group", { name: "Stages" })).toHaveCount(0);
      await expect(page.getByLabel("New job stage")).toHaveCount(0);
    } finally {
      await keelson.stop();
    }
  });

  test("changer de fichier change le graphe et vide l'historique", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByLabel("New job id").fill("lint");
      await page.getByLabel("Script").fill("make lint");
      await page.getByRole("button", { name: "Create job" }).click();
      await expect(page.locator("[data-job-id=lint]")).toBeVisible();
      await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
      expect(keelson.readAt(CI)).toContain("  lint:\n    runs-on: ubuntu-latest\n");

      await page.getByLabel("Pipeline file").selectOption(REL);
      await expect(page.locator("[data-job-id=publish]")).toBeVisible();
      await expect(page.locator("[data-job-id=lint]")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    } finally {
      await keelson.stop();
    }
  });

  test("un workflow réutilisable se dit partiel, avec ses mots", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByLabel("Pipeline file").selectOption(REL);
      const bar = page.getByRole("group", { name: "Partial pipeline" });
      await expect(bar).toContainText("1 reusable workflow");
      await expect(bar).not.toContainText("include");
    } finally {
      await keelson.stop();
    }
  });

  test("insérer un outil écrit ses étapes, sans choix de stage", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    const original = keelson.readAt(CI);
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Catalog" }).click();
      await page.getByRole("button", { name: "Gitleaks", exact: true }).click();
      await page.getByRole("button", { name: "Add to pipeline" }).click();
      await expect(page.getByTestId("insert-diff")).toContainText("gitleaks:");
      await expect(page.getByRole("combobox", { name: "Stage", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: `Insert into ${CI}` }).click();
      await expect(page.locator("[data-job-id=gitleaks]")).toBeAttached();
      expect(keelson.readAt(CI)).toContain("uses: actions/checkout@");
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(page.locator("[data-job-id=gitleaks]")).toHaveCount(0);
      expect(keelson.readAt(CI)).toBe(original);
    } finally {
      await keelson.stop();
    }
  });

  test("passer de GitHub à GitLab ne garde pas un niveau comme stage", async ({ page }) => {
    const keelson = await startKeelson({
      ...TREE,
      ".gitlab-ci.yml": "stages:\n  - build\n\ncompile:\n  stage: build\n  script:\n    - make\n",
    });
    try {
      await page.goto(keelson.url);
      await page.getByLabel("Pipeline file").selectOption(CI);
      await expect(page.locator("[data-job-id=test]")).toBeVisible();
      await page.getByLabel("Pipeline file").selectOption(".gitlab-ci.yml");
      await expect(page.locator("[data-job-id=compile]")).toBeVisible();
      await page.getByLabel("New job id").fill("lint");
      await page.getByLabel("Script").fill("make lint");
      await page.getByRole("button", { name: "Create job" }).click();
      await expect(page.locator("[data-job-id=lint]")).toBeVisible();
      expect(keelson.read()).toContain("lint:\n  stage: build\n");
    } finally {
      await keelson.stop();
    }
  });

  test("un job qui dépend de celui-ci n'est pas proposé comme need", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.locator("[data-job-id=build]").click();
      await expect(page.getByRole("button", { name: "Add need" })).toBeDisabled();
    } finally {
      await keelson.stop();
    }
  });

  test("changer de fichier s'annonce, les groupes nomment le fournisseur", async ({ page }) => {
    const keelson = await startKeelson({
      ...TREE,
      ".gitlab-ci.yml": "compile:\n  stage: build\n  script:\n    - make\n",
    });
    try {
      await page.goto(keelson.url);
      await expect(page.locator("optgroup[label='GitHub Actions'] option")).toHaveCount(2);
      await page.getByLabel("Pipeline file").selectOption(CI);
      await expect(page.getByRole("status").filter({ hasText: `${CI} opened.` })).toBeVisible();
      await page.getByRole("button", { name: "Coverage" }).click();
      await expect(page.getByTestId("coverage-scope")).toContainText("1 of 3 pipeline files");
    } finally {
      await keelson.stop();
    }
  });

  test("le panneau d'un job ne parle pas de stage", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.locator("[data-job-id=build]").click();
      await expect(page.getByRole("region", { name: "Job detail" })).toBeVisible();
      await expect(page.getByTestId("job-stage")).toHaveCount(0);
    } finally {
      await keelson.stop();
    }
  });

  test("ajouter un need sans options, et renommer met à jour needs", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.locator("[data-job-id=build]").click();
      await expect(page.getByRole("combobox", { name: "Stage", exact: true })).toHaveCount(0);
      await expect(page.getByLabel("Optional")).toHaveCount(0);
      await page.getByRole("textbox", { name: "Job id", exact: true }).fill("compile");
      await page.getByRole("button", { name: "Rename" }).click();
      await expect(page.locator("[data-job-id=compile]")).toBeVisible();
      await expect.poll(() => keelson.readAt(CI)).toContain("needs: compile");
    } finally {
      await keelson.stop();
    }
  });
});
