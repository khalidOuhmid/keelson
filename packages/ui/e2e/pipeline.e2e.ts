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
  await page.getByRole("button", { name: "Delete build-image" }).click();

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

test("invariants de mise en page : chaque job est dans la colonne du stage qu'il annonce", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole("button", { name: /lint/ })).toBeVisible();

  const boxes = await page.evaluate(() => {
    const read = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        width: rect.width,
        centre: rect.x + rect.width / 2,
        top: rect.y,
        bottom: rect.bottom,
      };
    };

    const columns: { name: string; x: number; width: number }[] = [];
    const jobs: { id: string; stage: string; centre: number; top: number; bottom: number }[] = [];

    for (const node of document.querySelectorAll(".react-flow__node")) {
      const id = node.getAttribute("data-id");
      if (id === null) {
        continue;
      }
      const geometry = read(node);
      if (id.startsWith("column:")) {
        columns.push({ name: id.slice("column:".length), x: geometry.x, width: geometry.width });
        continue;
      }
      const description = document.getElementById(`job-${id}-description`)?.textContent ?? "";
      jobs.push({
        id,
        stage: /Stage ([^.]+)\./.exec(description)?.[1] ?? "",
        centre: geometry.centre,
        top: geometry.top,
        bottom: geometry.bottom,
      });
    }

    return { columns, jobs };
  });

  expect(boxes.jobs.length).toBeGreaterThan(0);

  // La fixture de dev porte `lint`, un job sans arête dans un stage tardif : c'est la forme qui
  // faisait atterrir un job dans la colonne du stage précédent.
  expect(boxes.jobs.map((job) => job.id)).toContain("lint");

  for (const job of boxes.jobs) {
    const containing = boxes.columns
      .filter((column) => job.centre >= column.x && job.centre <= column.x + column.width)
      .map((column) => column.name);
    expect({ job: job.id, stages: containing }).toEqual({ job: job.id, stages: [job.stage] });
  }

  for (const column of boxes.columns) {
    const inside = boxes.jobs.filter((job) => job.stage === column.name);
    const header = page.getByRole("group", { name: `Stage ${column.name}` });
    await expect(header).toContainText(`${inside.length} ${inside.length === 1 ? "job" : "jobs"}`);

    const stacked = [...inside].sort((left, right) => left.top - right.top);
    for (const [index, job] of stacked.entries()) {
      const next = stacked[index + 1];
      expect({
        pair: `${job.id}/${next?.id ?? "—"}`,
        overlaps: next !== undefined && next.top < job.bottom,
      }).toEqual({ pair: `${job.id}/${next?.id ?? "—"}`, overlaps: false });
    }
  }
});

test("aucune arête n'est un arrêt de tabulation", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("button", { name: /lint/ })).toBeVisible();

  const focusable = await page.evaluate(
    () =>
      [...document.querySelectorAll(".react-flow__edge")].filter(
        (edge) => edge.getAttribute("tabindex") !== null,
      ).length,
  );

  const edges = await page.evaluate(() => document.querySelectorAll(".react-flow__edge").length);
  expect(edges).toBeGreaterThan(0);
  expect(focusable).toBe(0);
});

test("le panneau de détail se referme au clavier", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: /^lint/ }).click();
  await expect(page.getByRole("region", { name: "Job detail" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Job detail" })).toBeHidden();

  await page.getByRole("button", { name: /^lint/ }).click();
  await page.getByRole("button", { name: "Close job detail" }).click();
  await expect(page.getByRole("region", { name: "Job detail" })).toBeHidden();
});

test("supprimer un job demande confirmation avant d'écrire sur disque", async ({ page }) => {
  await open(page);
  const original = keelson.read();

  await page.getByRole("button", { name: /^lint/ }).click();
  await page.getByRole("button", { name: "Delete job" }).click();

  await expect(page.getByRole("alertdialog", { name: "Delete lint" })).toBeVisible();
  expect(keelson.read()).toBe(original);

  await page.getByRole("button", { name: "Cancel" }).click();
  expect(keelson.read()).toBe(original);

  await page.getByRole("button", { name: "Delete job" }).click();
  await page.getByRole("button", { name: "Delete lint" }).click();

  await expect(page.getByRole("button", { name: /^lint/ })).toBeHidden();
  expect(keelson.read()).not.toContain("\nlint:");
});

test("à 320 px le graphe reste rendu et mesurable", async ({ page }) => {
  // WCAG 1.4.10 : 320 px, c'est un zoom 400 % sur un portable de 1280 px. Avant correctif, les
  // deux colonnes `shrink-0` écrasaient `<main>` à zéro et le canevas n'était pas rendu du tout.
  await page.setViewportSize({ width: 320, height: 800 });
  await open(page);
  await expect(page.getByRole("button", { name: /^lint/ })).toBeVisible();

  const width = await page
    .getByRole("region", { name: "Pipeline graph" })
    .evaluate((element) => element.getBoundingClientRect().width);

  expect(width).toBeGreaterThan(0);
});

test("sélectionner un job détache visuellement ses arêtes", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /unit-tests/ }).click();
  await expect(page.getByRole("region", { name: "Job detail" })).toBeVisible();

  const widths = await page.evaluate(() =>
    [...document.querySelectorAll(".react-flow__edge path.react-flow__edge-path")].map(
      (path) => getComputedStyle(path).strokeWidth,
    ),
  );

  expect(widths.length).toBeGreaterThan(1);
  expect(new Set(widths).size).toBeGreaterThan(1);
});

test("le badge d'origine n'altère pas la casse de l'identifiant du fichier", async ({ page }) => {
  // `.deploy-base` est une clé de template GitLab, sensible à la casse et écrite par
  // l'utilisateur. L'afficher `.DEPLOY-BASE` est une donnée réécrite à l'écran. Seule la voix de
  // Keelson — « inherited from » — se met en petites capitales.
  await open(page);
  await page.getByRole("button", { name: /deploy-production/ }).click();

  const badge = page.getByTestId("origin-badge").first();
  await expect(badge).toBeVisible();

  const rendered = await badge.evaluate((element) => {
    const source = [...element.querySelectorAll("span")].find((span) =>
      span.textContent?.includes(".deploy-base"),
    );
    return {
      text: source?.textContent ?? "",
      transform: source === undefined ? "" : getComputedStyle(source).textTransform,
    };
  });

  expect(rendered.text).toContain(".deploy-base");
  expect(rendered.transform).toBe("none");
});

test("le graphe se recadre quand le panneau de détail s'ouvre", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("button", { name: /^lint/ })).toBeVisible();

  const rightmostColumn = () =>
    page.evaluate(() =>
      Math.max(
        ...[...document.querySelectorAll(".react-flow__node")]
          .filter((node) => node.getAttribute("data-id")?.startsWith("column:") === true)
          .map((node) => node.getBoundingClientRect().right),
      ),
    );

  expect(await rightmostColumn()).toBeGreaterThan(0);

  await page.getByRole("button", { name: /^lint/ }).click();
  await expect(page.getByRole("region", { name: "Job detail" })).toBeVisible();

  const panelLeft = await page
    .getByRole("region", { name: "Job detail" })
    .evaluate((element) => element.getBoundingClientRect().left);

  // Avant correctif, `fitView` ne tournait qu'au montage : l'ouverture du panneau retirait 352px
  // au canevas sans le recadrer, et la dernière colonne passait sous le panneau.
  await expect.poll(rightmostColumn).toBeLessThanOrEqual(panelLeft + 1);
});
