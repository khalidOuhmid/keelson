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

/** Extracts the items of the `stages:` list in file order. */
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

/** Extracts a job's block, from its key up to the next top-level key. */
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

/** Tabs until the focused element's accessible name matches, without ever clicking. */
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
  throw new Error(`no focusable element matches ${matcher}`);
}

async function focusedJob(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.jobId);
}

/** The graph is one tab stop (the first job); the arrows reach the others. */
async function reachLint(page: Page): Promise<void> {
  await tabUntil(page, /^build-image/);
  await page.keyboard.press("ArrowRight");
  for (const key of ["ArrowDown", "ArrowUp"]) {
    if ((await focusedJob(page)) === "lint") {
      return;
    }
    await page.keyboard.press(key);
  }
  expect(await focusedJob(page)).toBe("lint");
}

test("the graph is a single tab stop, traversed with the arrows", async ({ page }) => {
  await open(page);

  await tabUntil(page, /^build-image/);
  await page.keyboard.press("Tab");
  expect(await focusedJob(page)).toBeUndefined();
  await page.keyboard.press("Shift+Tab");
  expect(await focusedJob(page)).toBe("build-image");

  await page.keyboard.press("End");
  expect(await focusedJob(page)).toBe("deploy-production");
  await page.keyboard.press("Shift+ArrowLeft");
  expect(await focusedJob(page)).toBe("unit-tests");
  await page.keyboard.press("Shift+ArrowLeft");
  expect(await focusedJob(page)).toBe("build-image");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  expect(["secret-detection", "container-scan"]).toContain(await focusedJob(page));
  await page.keyboard.press("Home");
  expect(await focusedJob(page)).toBe("build-image");
});

test("a job reached with the keyboard is panned into view", async ({ page }) => {
  await open(page);
  const graph = page.getByRole("region", { name: "Pipeline graph" });
  const box = await graph.boundingBox();
  if (box === null) {
    throw new Error("no graph");
  }
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -400);
    await page.keyboard.up("Control");
  }
  await tabUntil(page, /^build-image/);
  await page.keyboard.press("End");
  expect(await focusedJob(page)).toBe("deploy-production");

  await expect
    .poll(async () => {
      const node = await page.locator('[data-job-id="deploy-production"]').boundingBox();
      const shown = await graph.boundingBox();
      return (
        node !== null &&
        shown !== null &&
        node.x >= shown.x &&
        node.x + node.width <= shown.x + shown.width &&
        node.y >= shown.y &&
        node.y + node.height <= shown.y + shown.height
      );
    })
    .toBe(true);
});

test("a job is reached by typing its name, without a mouse", async ({ page }) => {
  await open(page);

  await page.keyboard.press("Control+k");
  const field = page.getByRole("combobox", { name: "Find a job" });
  await expect(field).toBeFocused();
  await page.keyboard.type("deploy");
  await expect(page.getByRole("listbox", { name: "Jobs" }).getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("region", { name: "Job detail" })).toContainText("deploy-production");
  await expect(field).toHaveCount(0);
  await expect.poll(() => focusedJob(page)).toBe("deploy-production");
});

test("a job can be selected from the keyboard, without a mouse", async ({ page }) => {
  await open(page);

  await reachLint(page);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("region", { name: "Job detail" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Job detail" })).toContainText("lint");
});

test("the graph is one tab stop, and the arrow keys reach every job", async ({ page }) => {
  await open(page);
  const jobs = await page
    .locator("[data-job-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-job-id") ?? ""));
  expect(jobs.length).toBeGreaterThan(3);

  const focusedJob = () =>
    page.evaluate(() => document.activeElement?.getAttribute("data-job-id") ?? null);

  let entered: string | null = null;
  for (let step = 0; step < 40 && entered === null; step += 1) {
    await page.keyboard.press("Tab");
    entered = await focusedJob();
  }
  expect(entered).not.toBeNull();

  await page.keyboard.press("Tab");
  expect(await focusedJob()).toBeNull();
  await page.keyboard.press("Shift+Tab");
  expect(await focusedJob()).toBe(entered);

  const reached = new Set<string>([entered ?? ""]);
  for (let column = 0; column < jobs.length; column += 1) {
    await page.keyboard.press("Home");
    for (let move = 0; move < column; move += 1) {
      await page.keyboard.press("ArrowRight");
    }
    for (const key of ["ArrowDown", "ArrowUp"]) {
      for (let row = 0; row < jobs.length; row += 1) {
        reached.add((await focusedJob()) ?? "");
        await page.keyboard.press(key);
      }
    }
  }

  expect([...reached].filter(Boolean).sort()).toEqual([...jobs].sort());
});

test("changing a job's stage works from the keyboard", async ({ page }) => {
  await open(page);

  await reachLint(page);
  await page.keyboard.press("Enter");

  const stage = page.getByRole("combobox", { name: "Stage", exact: true });
  await stage.focus();
  await stage.selectOption("scan");

  // ADR 0004: browsing the select writes nothing. What catches a write sent by the selection is
  // `toBeEnabled`: sending puts the editor in pending in the same render, which disables
  // `Move to stage`, and once the write lands the job is already in the chosen stage, so the
  // button never comes back. Checked on 2026-11-12 by making the select submit: that assertion
  // fails first, every run; without it, `Undo` is the one that fails, after the pending wait.
  // A write deferred past these polls would pass all three, and the disk read below only sees a
  // write that has already landed.
  const move = page.getByRole("button", { name: "Move to stage" });
  await expect(move).toBeEnabled();
  await expect(page.getByTestId("pending-indicator")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  expect(jobBlock(keelson.read(), "lint")).toContain("stage: test");

  await move.focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: /lint/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await expect.poll(() => jobBlock(keelson.read(), "lint")).toContain("stage: scan");
});

test("adding a need works from the keyboard", async ({ page }) => {
  await open(page);

  await reachLint(page);
  await page.keyboard.press("Enter");

  await page.getByRole("combobox", { name: "Add a need" }).focus();
  await page.getByRole("combobox", { name: "Add a need" }).selectOption("build-image");

  await tabUntil(page, /^Add need$/);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: "Remove need build-image" })).toBeVisible();
});

test("removing a need works from the keyboard", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: /unit-tests/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Remove need build-image" })).toBeVisible();

  await page.getByRole("button", { name: "Remove need build-image" }).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: "Remove need build-image" })).toBeHidden();
  await expect.poll(() => jobBlock(keelson.read(), "unit-tests")).not.toContain("needs:");
});

test("creating a job works entirely from the keyboard", async ({ page }) => {
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

test("renaming a job works from the keyboard with Enter", async ({ page }) => {
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

test("adding a stage works from the keyboard", async ({ page }) => {
  await open(page);

  await page.getByRole("textbox", { name: "New stage name" }).focus();
  await page.keyboard.type("verify");
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("stage-column-name").filter({ hasText: "verify" })).toBeVisible();
  expect(keelson.read()).toContain("- verify");
});

test("moving a stage works from the keyboard", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: "Move deploy earlier" }).focus();
  await page.keyboard.press("Enter");

  await expect.poll(() => stageOrder(keelson.read())).toEqual(["build", "test", "deploy", "scan"]);
});

test("setting then removing the environment works from the keyboard", async ({ page }) => {
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

test("deleting a job works from the keyboard", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: /^lint/ }).focus();
  await page.keyboard.press("Enter");

  await page.getByRole("button", { name: "Delete job" }).focus();
  await page.keyboard.press("Enter");

  // ADR 0004: the confirmation can be reached and passed from the keyboard, like the rest.
  await expect(page.getByRole("alertdialog", { name: "Delete lint" })).toBeVisible();
  expect(keelson.read()).toContain("\nlint:");

  await page.getByRole("button", { name: "Delete lint" }).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: /^lint/ })).toBeHidden();
  expect(keelson.read()).not.toContain("\nlint:");
});

test("undo and redo work with keyboard shortcuts", async ({ page }) => {
  await open(page);
  const original = keelson.read();

  await page.getByRole("textbox", { name: "New stage name" }).focus();
  await page.keyboard.type("verify");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

  await page.getByRole("region", { name: "Pipeline graph" }).click();
  await page.keyboard.press("Control+z");
  await expect.poll(() => keelson.read()).toBe(original);
  // The disk changes before the response arrives: Redo exists only once it has.
  await expect(page.getByRole("button", { name: "Redo" })).toBeEnabled();

  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => keelson.read()).not.toBe(original);
});

test("the undo shortcut does not steal undo from a text field", async ({ page }) => {
  // The 2026-10-22 independent review proved the previous version could not fail: no operation
  // was submitted before Ctrl+Z, so the undo stack was empty and `undo()` returned immediately,
  // whether the `inTextEntry` guard worked or not. A successful operation is needed first, so
  // that a Ctrl+Z would actually steal something if it got through.
  await open(page);

  await page.getByRole("textbox", { name: "New stage name" }).fill("verify");
  await page.getByRole("button", { name: "Add stage" }).click();
  await expect(page.getByTestId("stage-column-name").filter({ hasText: "verify" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

  const afterOperation = keelson.read();
  expect(afterOperation).toContain("verify");

  const field = page.getByRole("textbox", { name: "New stage name" });
  await field.focus();
  await page.keyboard.type("publish");
  await page.keyboard.press("Control+z");

  // Ctrl+Z belongs to the field: the document undo must not fire, so the added stage stays on
  // disk and Undo stays available.
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  expect(keelson.read()).toBe(afterOperation);
});

test("a diagnostic can be selected from the keyboard", async ({ page }) => {
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
