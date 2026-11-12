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

async function focusedInside(page: Page, selector: string): Promise<boolean> {
  return page.evaluate(
    (query) => document.querySelector(query)?.contains(document.activeElement) ?? false,
    selector,
  );
}

test("the delete confirmation keeps Tab inside itself", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "lint" }).click();
  await page.getByRole("button", { name: "Delete job" }).click();
  await expect(page.getByRole("button", { name: "Delete lint" })).toBeFocused();

  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("Tab");
    expect(await focusedInside(page, '[role="alertdialog"]')).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Delete job" })).toBeFocused();
});

test("below lg, an overlay takes focus, keeps it, and gives it back on close", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await open(page);

  await page.getByRole("button", { name: "Panel" }).click();
  await expect(page.getByRole("button", { name: "Close panel" })).toBeFocused();
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("Tab");
    expect(await focusedInside(page, 'aside[aria-label="Edit pipeline"]')).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Panel" })).toBeFocused();

  await page.getByRole("button", { name: "lint" }).click();
  await expect(page.getByRole("button", { name: "Close job detail" })).toBeFocused();
  for (let step = 0; step < 30; step += 1) {
    await page.keyboard.press("Tab");
    expect(await focusedInside(page, 'aside[aria-label="Job"]')).toBe(true);
  }
});

test("a wrapped snippet line continues under its content, never at the left edge", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  await page.getByRole("button", { name: "Catalog", exact: true }).click();
  await page
    .getByRole("region", { name: "Tool catalogue" })
    .getByRole("button", { name: "Bandit" })
    .click();
  const detail = page.getByRole("region", { name: "Tool detail" });
  await expect(detail.locator(".cm-line").first()).toBeVisible();
  const offenders = await page.evaluate(() => {
    const result = { wrapped: 0, bad: [] as string[] };
    for (const line of document.querySelectorAll<HTMLElement>(
      '[aria-label="Tool detail"] .cm-line',
    )) {
      const text = line.textContent ?? "";
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      const boxes: { top: number; left: number; blank: boolean }[] = [];
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const value = node.textContent ?? "";
        for (let offset = 0; offset < value.length; offset += 1) {
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          const box = range.getBoundingClientRect();
          boxes.push({
            top: Math.round(box.top),
            left: box.left,
            blank: /\s/.test(value[offset] ?? ""),
          });
        }
      }
      const firstTop = boxes[0]?.top;
      const content = boxes.find((box) => !box.blank);
      const continuation = boxes.filter((box) => box.top !== firstTop && !box.blank);
      if (content === undefined || continuation.length === 0) {
        continue;
      }
      result.wrapped += 1;
      const start = Math.min(...continuation.map((box) => box.left));
      if (start < content.left) {
        result.bad.push(text);
      }
    }
    return result;
  });
  expect(offenders.bad).toEqual([]);
  expect(offenders.wrapped).toBeGreaterThan(0);
});
