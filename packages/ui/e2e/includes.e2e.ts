import { expect, test } from "@playwright/test";
import { startKeelson, type Tree } from "./support/server.ts";

const INCLUDED_PATH = "ci/jobs.yml";

const INCLUDED = [
  "sast:",
  "  stage: test",
  "  needs:",
  "    - compile",
  "  script:",
  "    - make scan",
  "",
].join("\n");

const TREE: Tree = {
  ".gitlab-ci.yml": [
    "include:",
    `  - /${INCLUDED_PATH}`,
    "  - template: Jobs/Secret-Detection.gitlab-ci.yml",
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
  ].join("\n"),
  [INCLUDED_PATH]: INCLUDED,
};

test.describe("include locaux sur le binaire réel", () => {
  test("les jobs d'un fichier inclus sont dessinés, et marqués read-only", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);

      const sast = page.locator('[data-job-id="sast"]');
      await expect(sast).toBeVisible();
      await expect(sast).toHaveAttribute("data-included", "true");
      await expect(sast).toContainText("read-only");

      // Le job du fichier principal n'en porte aucune marque : l'assertion négative est ce qui
      // empêche un marquage appliqué à tous les nœuds de passer pour un succès.
      const compile = page.locator('[data-job-id="compile"]');
      await expect(compile).toHaveAttribute("data-included", "false");
      await expect(compile).not.toContainText("read-only");
    } finally {
      await keelson.stop();
    }
  });

  test("l'indicateur de pipeline partiel nomme l'include non résolu", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);

      const bar = page.getByRole("group", { name: "Partial pipeline" });
      await expect(bar).toContainText("1 unresolved include");
      await expect(bar).toContainText(
        "Some includes are not resolved, so jobs may be missing from this view.",
      );
      await expect(bar).toContainText("Jobs/Secret-Detection.gitlab-ci.yml");
      await expect(bar).toContainText("template");
    } finally {
      await keelson.stop();
    }
  });

  /** La garantie du produit, vérifiée sur le **disque** après un parcours complet de l'écran :
   *  sélectionner un job inclus, tenter de l'éditer, et constater que son fichier est resté octet
   *  pour octet celui d'avant. Une assertion sur l'écran seul ne dirait rien de ce qui est écrit. */
  test("un job inclus ne peut pas être édité, et son fichier reste intact", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.locator('[data-job-id="sast"]').click();

      await expect(page.getByTestId("job-source-file")).toContainText(INCLUDED_PATH);

      const editor = page.getByRole("group", { name: "Job editor" });
      await expect(editor).toContainText("Editing is off for this job");
      await expect(editor.getByRole("button", { name: /^Rename$/ })).toBeDisabled();
      await expect(editor.getByRole("button", { name: /Delete job/ })).toBeDisabled();
      await expect(editor.getByRole("button", { name: /Add need/ })).toBeDisabled();

      expect(keelson.readAt(INCLUDED_PATH)).toBe(INCLUDED);
    } finally {
      await keelson.stop();
    }
  });

  test("le bloc opaque d'un job inclus montre les octets de son fichier", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.locator('[data-job-id="sast"]').click();

      const block = page.getByRole("group", { name: "Opaque block script" });
      // `make scan` n'existe que dans le fichier inclus ; le fichier principal contient `make`.
      await expect(block).toContainText("make scan");
    } finally {
      await keelson.stop();
    }
  });

  /** Le watcher doit suivre les fichiers inclus : sans cela l'écran reste sur un pipeline périmé
   *  après qu'un collègue a touché `ci/jobs.yml`, et rien ne le dit. */
  test("modifier un fichier inclus met l'écran à jour", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await expect(page.locator('[data-job-id="sast"]')).toBeVisible();

      keelson.writeAt(
        INCLUDED_PATH,
        `${INCLUDED}\ntardif:\n  stage: test\n  script:\n    - make\n`,
      );

      await expect(page.locator('[data-job-id="tardif"]')).toBeVisible({ timeout: 10_000 });
    } finally {
      await keelson.stop();
    }
  });

  test("les contrôles de stages restent actifs : la liste vient du fichier principal", async ({
    page,
  }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await expect(page.getByRole("button", { name: /^Add stage$/ })).toBeEnabled();
    } finally {
      await keelson.stop();
    }
  });
});
