import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startKeelson } from "./support/server.ts";

const WORKFLOW = ".github/workflows/scan.yml";

test("a workflow created while Keelson runs joins the file picker, and leaves it when removed", async ({
  page,
}) => {
  const keelson = await startKeelson();
  try {
    await page.goto(keelson.url);
    await expect(page.locator("[data-job-id=lint]")).toBeVisible();
    await expect(page.getByLabel("Pipeline file")).toHaveCount(0);

    keelson.writeAt(
      WORKFLOW,
      "on: push\njobs:\n  scan:\n    runs-on: ubuntu-latest\n    steps:\n      - run: make scan\n",
    );
    const picker = page.getByLabel("Pipeline file");
    await expect(picker.locator("option")).toHaveText([".gitlab-ci.yml", "scan.yml"]);

    await picker.selectOption(WORKFLOW);
    await expect(page.locator("[data-job-id=scan]")).toBeVisible();

    await picker.selectOption(".gitlab-ci.yml");
    await expect(page.locator("[data-job-id=lint]")).toBeVisible();
    rmSync(join(keelson.dir, WORKFLOW));
    await expect(page.getByLabel("Pipeline file")).toHaveCount(0);
  } finally {
    await keelson.stop();
  }
});

test("a write from another tab reloads this one; the writing tab is not told its own write changed the disk", async ({
  browser,
}) => {
  const keelson = await startKeelson();
  const writer = await browser.newPage();
  const reader = await browser.newPage();
  try {
    await writer.goto(keelson.url);
    await reader.goto(keelson.url);
    await expect(writer.locator("[data-job-id=lint]")).toBeVisible();
    await expect(reader.locator("[data-job-id=lint]")).toBeVisible();

    await writer.getByRole("textbox", { name: "New stage name" }).fill("verify");
    await writer.getByRole("button", { name: "Add stage" }).click();
    await expect(
      writer.getByTestId("stage-column-name").filter({ hasText: "verify" }),
    ).toBeVisible();

    await expect(
      reader.getByTestId("stage-column-name").filter({ hasText: "verify" }),
    ).toBeVisible();
    await expect(
      reader.getByText("Another Keelson tab wrote the file.", { exact: false }),
    ).toBeVisible();
    await expect(writer.getByRole("button", { name: "Undo" })).toBeEnabled();
    await expect(
      writer.getByText("Another Keelson tab wrote the file.", { exact: false }),
    ).toHaveCount(0);
  } finally {
    await writer.close();
    await reader.close();
    await keelson.stop();
  }
});
