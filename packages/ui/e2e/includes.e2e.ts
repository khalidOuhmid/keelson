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

  /** Ce que ce test mesure : l'écran n'offre aucun contrôle sur un job inclus, et le fichier est
   *  intact après le parcours. La relecture du disque est un **garde-fou**, pas la mesure
   *  principale : aucun contrôle, donc aucune requête, donc rien n'écrirait de toute façon.
   *  La garantie sur les octets contre une requête réellement envoyée est mesurée dans
   *  `packages/server/test/includes.test.ts`, où le serveur écrit pour de vrai. */
  test("un job inclus ne peut pas être édité, et son fichier reste intact", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.locator('[data-job-id="sast"]').click();

      await expect(page.getByTestId("job-source-file")).toContainText(INCLUDED_PATH);

      await expect(page.getByText("Editing is off for this job")).toBeVisible();
      await expect(page.getByRole("group", { name: "Job editor" })).toHaveCount(0);

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

test("dépliée, la bande partielle ne dévore pas l'écran", async ({ page }) => {
  // Mesuré pendant `polish` : avec 31 includes non résolus, 729 px sur 800, et 2751 px à 375 de
  // large. Une borne en pourcentage ne vaut que sur un élément dont le parent a une hauteur.
  const templates = Array.from(
    { length: 40 },
    (_, index) => `  - template: Jobs/Template-${index}.gitlab-ci.yml`,
  );
  const keelson = await startKeelson({
    ".gitlab-ci.yml": [
      "include:",
      ...templates,
      "",
      "compile:",
      "  script:",
      "    - make",
      "",
    ].join("\n"),
  });
  try {
    await page.goto(keelson.url);
    await page.locator("summary").click();

    const bar = page.getByRole("group", { name: "Partial pipeline" });
    await expect(bar).toContainText("Jobs/Template-0.gitlab-ci.yml");
    const box = await bar.boundingBox();
    const viewport = page.viewportSize();
    if (box === null || viewport === null) {
      throw new Error("bande ou fenêtre sans géométrie");
    }
    expect(box.height).toBeLessThanOrEqual(viewport.height / 3 + 1);
  } finally {
    await keelson.stop();
  }
});

test.describe("la bande partielle au clavier, sur le vrai navigateur", () => {
  /** `happy-dom` n'implémente pas le basculement natif de `<details>` à la touche Entrée : le test
   *  unitaire ne peut mesurer que la focalisabilité du résumé. Le dépliage, lui, ne se vérifie que
   *  sur un navigateur réel, et c'est ici. */
  test("le résumé se déplie et se replie à la touche Entrée", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);

      const summary = page.locator("summary");
      await summary.focus();
      await expect(summary).toBeFocused();

      const details = page.locator("details");
      const opened = await details.evaluate((node) => node.hasAttribute("open"));

      await page.keyboard.press("Enter");
      await expect.poll(() => details.evaluate((node) => node.hasAttribute("open"))).toBe(!opened);

      await page.keyboard.press("Enter");
      await expect.poll(() => details.evaluate((node) => node.hasAttribute("open"))).toBe(opened);
    } finally {
      await keelson.stop();
    }
  });

  test("le nœud inclus ne porte plus de title, et sa marque reste lisible", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      const sast = page.locator('[data-job-id="sast"]');
      // Un `title` n'apparaît nulle part dans l'arbre d'accessibilité quand un
      // `aria-describedby` est présent : deux formulations du même fait, une seule jamais lue.
      await expect(sast).not.toHaveAttribute("title", /./);
      await expect(sast).toContainText("read-only");
    } finally {
      await keelson.stop();
    }
  });

  test("l'en-tête annonce le nombre de fichiers inclus résolus", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      const tag = page.getByTestId("included-files-tag");
      await expect(tag).toHaveText("1 included file");
      await expect(tag).toHaveAttribute("title", `Resolved includes: ${INCLUDED_PATH}`);
    } finally {
      await keelson.stop();
    }
  });
});
