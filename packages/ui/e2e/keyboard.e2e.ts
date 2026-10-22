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

/** Extrait les items de la liste `stages:` dans l'ordre du fichier. */
function stageOrder(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith("stages:"));
  if (start === -1) {
    return [];
  }
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^\s+-\s+(\S+)/.exec(line);
    if (match?.[1] === undefined) {
      break;
    }
    items.push(match[1]);
  }
  return items;
}

/** Extrait le bloc d'un job, de sa clé jusqu'à la prochaine clé de premier niveau. */
function jobBlock(text: string, id: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${id}:`));
  if (start === -1) {
    return "";
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\S/.test(line));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

/** Tabule jusqu'à ce que le nom accessible de l'élément focalisé corresponde, sans jamais cliquer. */
async function tabUntil(page: Page, matcher: RegExp, limit = 80): Promise<void> {
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => {
      const active = document.activeElement;
      if (active === null) {
        return "";
      }
      return (
        active.getAttribute("aria-label") ??
        active.getAttribute("title") ??
        active.textContent ??
        ""
      );
    });
    if (matcher.test(name)) {
      return;
    }
  }
  throw new Error(`aucun élément focalisable ne correspond à ${matcher}`);
}

test("un job se sélectionne au clavier, sans souris", async ({ page }) => {
  await open(page);

  await tabUntil(page, /^lint/);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("region", { name: "Job detail" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Job detail" })).toContainText("lint");
});

test("changer le stage d'un job se fait au clavier", async ({ page }) => {
  await open(page);

  await tabUntil(page, /^lint/);
  await page.keyboard.press("Enter");

  const stage = page.getByRole("combobox", { name: "Stage", exact: true });
  await stage.focus();
  await stage.selectOption("scan");

  // ADR 0004 : parcourir le sélecteur n'écrit rien. Le fichier ne bouge qu'au geste explicite.
  expect(jobBlock(keelson.read(), "lint")).toContain("stage: test");

  await page.getByRole("button", { name: "Move to stage" }).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: /lint/ })).toBeVisible();
  await expect.poll(() => jobBlock(keelson.read(), "lint")).toContain("stage: scan");
});

test("ajouter un need se fait au clavier", async ({ page }) => {
  await open(page);

  await tabUntil(page, /^lint/);
  await page.keyboard.press("Enter");

  await page.getByRole("combobox", { name: "Add a need" }).focus();
  await page.getByRole("combobox", { name: "Add a need" }).selectOption("build-image");

  await tabUntil(page, /^Add need$/);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: "Remove need build-image" })).toBeVisible();
});

test("retirer un need se fait au clavier", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: /unit-tests/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Remove need build-image" })).toBeVisible();

  await page.getByRole("button", { name: "Remove need build-image" }).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: "Remove need build-image" })).toBeHidden();
  await expect.poll(() => jobBlock(keelson.read(), "unit-tests")).not.toContain("needs:");
});

test("créer un job se fait entièrement au clavier", async ({ page }) => {
  await open(page);

  await page.getByRole("textbox", { name: "New job id" }).focus();
  await page.keyboard.type("paquet");

  await page.getByRole("combobox", { name: "New job stage" }).selectOption("deploy");

  await page.getByRole("textbox", { name: "Script" }).focus();
  await page.keyboard.type("make package");

  await tabUntil(page, /^Create job$/);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: /paquet/ })).toBeVisible();
  expect(keelson.read()).toContain("paquet:");
});

test("renommer un job se fait au clavier par Entrée", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: /^lint/ }).focus();
  await page.keyboard.press("Enter");

  const field = page.getByRole("textbox", { name: "Job id", exact: true });
  await field.focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("lint-sources");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: /lint-sources/ })).toBeVisible();
  expect(keelson.read()).toContain("lint-sources:");
});

test("ajouter un stage se fait au clavier", async ({ page }) => {
  await open(page);

  await page.getByRole("textbox", { name: "New stage name" }).focus();
  await page.keyboard.type("verify");
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("stage-column-name").filter({ hasText: "verify" })).toBeVisible();
  expect(keelson.read()).toContain("- verify");
});

test("déplacer un stage se fait au clavier", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: "Move deploy earlier" }).focus();
  await page.keyboard.press("Enter");

  await expect.poll(() => stageOrder(keelson.read())).toEqual(["build", "test", "deploy", "scan"]);
});

test("définir puis retirer l'environnement se fait au clavier", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: /^lint/ }).focus();
  await page.keyboard.press("Enter");

  await page.getByRole("textbox", { name: "Environment name" }).focus();
  await page.keyboard.type("review");
  await tabUntil(page, /^Set environment$/);
  await page.keyboard.press("Enter");

  await expect.poll(() => keelson.read()).toContain("environment: review");

  await page.getByRole("button", { name: "Remove environment" }).focus();
  await page.keyboard.press("Enter");

  await expect.poll(() => keelson.read()).not.toContain("environment: review");
});

test("supprimer un job se fait au clavier", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: /^lint/ }).focus();
  await page.keyboard.press("Enter");

  await page.getByRole("button", { name: "Delete job" }).focus();
  await page.keyboard.press("Enter");

  // ADR 0004 : la confirmation est atteignable et franchissable au clavier, comme le reste.
  await expect(page.getByRole("alertdialog", { name: "Delete lint" })).toBeVisible();
  expect(keelson.read()).toContain("\nlint:");

  await page.getByRole("button", { name: "Delete lint" }).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: /^lint/ })).toBeHidden();
  expect(keelson.read()).not.toContain("\nlint:");
});

test("annuler et rétablir se font au raccourci clavier", async ({ page }) => {
  await open(page);
  const original = keelson.read();

  await page.getByRole("textbox", { name: "New stage name" }).focus();
  await page.keyboard.type("verify");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

  await page.getByRole("region", { name: "Pipeline graph" }).click();
  await page.keyboard.press("Control+z");
  await expect.poll(() => keelson.read()).toBe(original);

  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => keelson.read()).not.toBe(original);
});

test("le raccourci d'annulation ne vole pas l'annulation d'un champ de saisie", async ({
  page,
}) => {
  await open(page);
  const original = keelson.read();

  const field = page.getByRole("textbox", { name: "New stage name" });
  await field.focus();
  await page.keyboard.type("verify");
  await page.keyboard.press("Control+z");

  expect(keelson.read()).toBe(original);
});

test("un diagnostic se sélectionne au clavier", async ({ page }) => {
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

  await page.getByRole("button", { name: /UNKNOWN_NEED/ }).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("region", { name: "Job detail" })).toContainText("unit");
});
