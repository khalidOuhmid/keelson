import { expect, type Page, test } from "@playwright/test";
import { type Running, startKeelson } from "./support/server.ts";

let keelson: Running;

test.beforeEach(async () => {
  keelson = await startKeelson();
});

test.afterEach(async () => {
  await keelson.stop();
});

async function open(page: Page): Promise<void> {
  await page.goto(keelson.url);
  await expect(page.getByRole("region", { name: "Pipeline graph" })).toBeVisible();
}

test("affiche les stages, les jobs et les badges d'origine de la fixture", async ({ page }) => {
  await open(page);

  for (const stage of ["build", "test", "scan", "deploy"]) {
    await expect(page.getByTestId("stage-column-name").filter({ hasText: stage })).toBeVisible();
  }

  for (const job of ["build-image", "unit-tests", "secret-detection", "deploy-production"]) {
    await expect(page.getByRole("button", { name: new RegExp(job) })).toBeVisible();
  }

  await expect(page.getByText("inherited from .deploy-base").first()).toBeVisible();
});

test("le token est retiré de l'URL après chargement", async ({ page }) => {
  await open(page);
  expect(page.url()).not.toContain("token=");
});

test("renommer un job écrit le fichier sur disque", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: /^lint/ }).click();
  await expect(page.getByRole("region", { name: "Job detail" })).toBeVisible();

  const field = page.getByRole("textbox", { name: "Job id", exact: true });
  await field.fill("lint-sources");
  await page.getByRole("button", { name: "Rename" }).click();

  await expect(page.getByRole("button", { name: /lint-sources/ })).toBeVisible();

  const onDisk = keelson.read();
  expect(onDisk).toContain("lint-sources:");
  expect(onDisk).not.toContain("\nlint:");
  expect(onDisk).toContain("# Keelson dev fixture");
});

test("ajouter un need écrit le fichier et apparaît dans le panneau", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: /^lint/ }).click();
  await page.getByRole("combobox", { name: "Add a need" }).selectOption("build-image");
  await page.getByRole("button", { name: "Add need" }).click();

  await expect(page.getByRole("button", { name: "Remove need build-image" })).toBeVisible();
  expect(keelson.read()).toMatch(/lint:[\s\S]*needs:[\s\S]*build-image/);
});

test("undo restaure les octets d'origine", async ({ page }) => {
  await open(page);
  const original = keelson.read();

  await page.getByRole("textbox", { name: "New stage name" }).fill("verify");
  await page.getByRole("button", { name: "Add stage" }).click();

  await expect(page.getByTestId("stage-column-name").filter({ hasText: "verify" })).toBeVisible();
  expect(keelson.read()).not.toBe(original);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  expect(keelson.read()).toBe(original);
});

test("une modification externe du fichier recharge l'UI", async ({ page }) => {
  await open(page);

  keelson.write(`${keelson.read()}\nvenu-du-dehors:\n  stage: build\n  script:\n    - echo\n`);

  await expect(page.getByRole("button", { name: /venu-du-dehors/ })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("notice-kind")).toContainText("Reloaded");
});

test("la suppression du fichier affiche l'état supprimé", async ({ page }) => {
  await open(page);

  const { rmSync } = await import("node:fs");
  rmSync(keelson.file);

  await expect(page.getByRole("heading", { name: /deleted/i })).toBeVisible({ timeout: 10_000 });
});

test("un 409 affiche le message, recharge et vide l'historique", async ({ page }) => {
  await page.route("**/api/events*", (route) => route.abort());
  await open(page);

  await page.getByRole("textbox", { name: "New stage name" }).fill("verify");
  await page.getByRole("button", { name: "Add stage" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

  keelson.write(`${keelson.read()}\nhors-keelson:\n  stage: build\n  script:\n    - echo\n`);

  await page.getByRole("textbox", { name: "New stage name" }).fill("publish");
  await page.getByRole("button", { name: "Add stage" }).click();

  await expect(page.getByTestId("notice-kind")).toContainText("Not applied");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  expect(keelson.read()).not.toContain("publish");
});

test("une erreur métier affiche le message du serveur", async ({ page }) => {
  await open(page);

  await page.getByRole("textbox", { name: "New stage name" }).fill("build");
  await page.getByRole("button", { name: "Add stage" }).click();

  await expect(page.getByText("STAGE_EXISTS")).toBeVisible();
});

test("supprimer un job référencé liste les jobs qui le référencent", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: /build-image/ }).click();
  await page.getByRole("button", { name: "Delete job" }).click();

  await expect(page.getByText("JOB_REFERENCED")).toBeVisible();
  const banner = page.getByRole("alert");
  await expect(banner).toContainText("unit-tests");
});

test("cliquer un diagnostic sélectionne le job concerné", async ({ page }) => {
  keelson.write(
    [
      "stages:",
      "  - build",
      "  - test",
      "",
      "compile:",
      "  stage: build",
      "  script:",
      "    - make",
      "",
      "unit:",
      "  stage: test",
      "  needs:",
      "    - absent",
      "  script:",
      "    - make check",
      "",
    ].join("\n"),
  );

  await page.goto(keelson.url);
  await expect(page.getByRole("region", { name: "Pipeline graph" })).toBeVisible();

  await page.getByRole("button", { name: /UNKNOWN_NEED/ }).click();
  await expect(page.getByRole("region", { name: "Job detail" })).toContainText("unit");
});
