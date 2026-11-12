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
  await expect(page.locator("[data-job-id]").first()).toBeVisible();
}

/** The accent as the browser resolves it, so the comparison does not depend on colour syntax. */
async function accent(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-accent)";
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
}

test("the focus ring is the accent on every tab stop, from the first frame", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "build-image" }).click();
  await expect(page.getByRole("region", { name: "Job detail" })).toBeVisible();
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  const expected = await accent(page);

  const seen: { name: string; color: string; style: string }[] = [];
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press("Tab");
    seen.push(
      await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        if (active === null || active === document.body) {
          return { name: "body", color: "", style: "none" };
        }
        const style = getComputedStyle(active);
        return {
          name: active.getAttribute("aria-label") ?? active.textContent?.slice(0, 30) ?? "",
          color: style.outlineColor,
          style: style.outlineStyle,
        };
      }),
    );
  }

  const ringed = seen.filter((entry) => entry.style !== "none");
  expect(ringed.length).toBeGreaterThan(20);
  expect(ringed.filter((entry) => entry.color !== expected)).toEqual([]);
});

async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const targets = [
      ...document.querySelectorAll<HTMLElement>(
        "header button, header select, aside button, aside select, aside input:not([type=checkbox]), aside summary, aside a, main form select, main summary",
      ),
      ...[...document.querySelectorAll<HTMLInputElement>("aside input[type=checkbox]")].map(
        (input) => input.closest("label") ?? input,
      ),
    ];
    return targets
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          name: element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 30),
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      })
      .filter((entry) => entry.width < 24 || entry.height < 24);
  });
}

test("every control of the editing surfaces is at least 24 × 24 px", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "unit-tests" }).click();
  await expect(page.getByRole("region", { name: "Job detail" })).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);

  await page.getByRole("button", { name: "Coverage", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Coverage" })).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);

  await page.getByRole("button", { name: "Toolchain", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Toolchain" })).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);

  await page.getByRole("button", { name: "Catalog", exact: true }).click();
  await page.getByRole("region", { name: "Tool catalogue" }).getByRole("button").first().click();
  await expect(page.getByRole("region", { name: "Tool detail" })).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
});
