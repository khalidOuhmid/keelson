import { expect, test } from "@playwright/test";
import { startKeelson } from "./support/server.ts";

test("desktop and mobile screenshots", async ({ browser }) => {
  const keelson = await startKeelson();

  for (const [name, size] of [
    ["desktop", { width: 1440, height: 900 }],
    ["mobile", { width: 390, height: 844 }],
  ] as const) {
    const page = await browser.newPage({ viewport: size });
    await page.goto(keelson.url);
    await expect(page.getByRole("region", { name: "Pipeline graph" })).toBeVisible();
    await page.getByRole("button", { name: /deploy-production/ }).click();
    await expect(page.getByRole("region", { name: "Job detail" })).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({
      path: `packages/ui/.impeccable/review/${name}.png`,
      fullPage: false,
    });
    await page.close();
  }

  await keelson.stop();
});
