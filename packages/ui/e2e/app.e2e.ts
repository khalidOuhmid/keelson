import { expect, test } from "@playwright/test";

test("la page servie par Vite affiche le titre « Keelson »", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Keelson");
  await expect(page).toHaveTitle("Keelson");
});
