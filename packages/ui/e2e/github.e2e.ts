import { expect, test } from "@playwright/test";
import { startKeelson, type Tree } from "./support/server.ts";

const CI = ".github/workflows/ci.yml";
const REL = ".github/workflows/release.yml";

const TREE: Tree = {
  [CI]: [
    "name: CI",
    "on: push",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: make",
    "  test:",
    "    needs: build",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: make check",
    "",
  ].join("\n"),
  [REL]: [
    "on: push",
    "jobs:",
    "  publish:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: gitleaks/gitleaks-action@v2",
    "  shared:",
    "    uses: acme/ci/.github/workflows/scan.yml@v1",
    "",
  ].join("\n"),
};

test.describe("GitHub Actions on the real binary", () => {
  test("without .gitlab-ci.yml: workflows open, with derived levels", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await expect(page.locator("[data-job-id=build]")).toBeVisible();
      await expect(page.getByText("level 2").first()).toBeVisible();
      await expect(page.getByRole("group", { name: "Stages" })).toHaveCount(0);
      await expect(page.getByLabel("New job stage")).toHaveCount(0);
    } finally {
      await keelson.stop();
    }
  });

  test("switching files changes the graph and clears history", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByLabel("New job id").fill("lint");
      await page.getByLabel("Script").fill("make lint");
      await page.getByRole("button", { name: "Create job" }).click();
      await expect(page.locator("[data-job-id=lint]")).toBeVisible();
      await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
      expect(keelson.readAt(CI)).toContain("  lint:\n    runs-on: ubuntu-latest\n");

      await page.getByLabel("Pipeline file").selectOption(REL);
      await expect(page.locator("[data-job-id=publish]")).toBeVisible();
      await expect(page.locator("[data-job-id=lint]")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    } finally {
      await keelson.stop();
    }
  });

  test("a reusable workflow reports itself as partial, in its own words", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByLabel("Pipeline file").selectOption(REL);
      const bar = page.getByRole("group", { name: "Partial pipeline" });
      await expect(bar).toContainText("1 reusable workflow");
      await expect(bar).not.toContainText("include");
    } finally {
      await keelson.stop();
    }
  });

  test("the partial bar names the job that calls the unread workflow", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByLabel("Pipeline file").selectOption(REL);
      const bar = page.getByRole("group", { name: "Partial pipeline" });
      await bar.locator("summary").click();
      await expect(bar.getByRole("listitem")).toContainText(/called by\s*shared/);
    } finally {
      await keelson.stop();
    }
  });

  test("levels are named once, by their column, and read as levels", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await expect(page.locator("[data-job-id=test]")).toBeVisible();
      await expect(page.getByRole("group", { name: "Level 2", exact: true })).toBeVisible();
      await expect(page.getByRole("group", { name: /^Stage / })).toHaveCount(0);
      await expect(page.locator("[data-job-id=test]")).not.toContainText("level");
      await expect(page.locator("[data-job-id=build]")).not.toContainText("level");

      await page.getByRole("button", { name: "Table", exact: true }).click();
      const table = page.getByRole("table", { name: "Pipeline jobs" });
      await expect(table.getByRole("columnheader", { name: "Level" })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Stage" })).toHaveCount(0);
    } finally {
      await keelson.stop();
    }
  });

  test("the chosen file is kept in the address, without the token", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.getByLabel("Pipeline file").selectOption(REL);
      await expect(page.locator("[data-job-id=publish]")).toBeVisible();
      const address = new URL(page.url());
      expect(address.search).not.toContain("token");
      expect(address.hash).not.toContain("token");
      expect(decodeURIComponent(address.hash)).toContain(REL);

      await page.goto(`${keelson.url}${address.hash}`);
      await expect(page.locator("[data-job-id=publish]")).toBeVisible();
      await expect(page.getByLabel("Pipeline file")).toHaveValue(REL);
      expect(new URL(page.url()).hash).toBe(address.hash);
    } finally {
      await keelson.stop();
    }
  });

  test("a file named in the address that no longer exists opens the first one", async ({
    page,
  }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(`${keelson.url}#file=${encodeURIComponent(".github/workflows/gone.yml")}`);
      await expect(page.locator("[data-job-id=build]")).toBeVisible();
    } finally {
      await keelson.stop();
    }
  });

  test("inserting a tool writes its steps, with no stage choice", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    const original = keelson.readAt(CI);
    try {
      await page.goto(keelson.url);
      await page.getByRole("button", { name: "Catalog" }).click();
      await page.getByRole("button", { name: "Gitleaks", exact: true }).click();
      await page.getByRole("button", { name: "Add to pipeline" }).click();
      await expect(page.getByTestId("insert-diff")).toContainText("gitleaks:");
      await expect(page.getByRole("combobox", { name: "Stage", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: `Insert into ${CI}` }).click();
      await expect(page.locator("[data-job-id=gitleaks]")).toBeAttached();
      expect(keelson.readAt(CI)).toContain("uses: actions/checkout@");
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(page.locator("[data-job-id=gitleaks]")).toHaveCount(0);
      expect(keelson.readAt(CI)).toBe(original);
    } finally {
      await keelson.stop();
    }
  });

  test("switching from GitHub to GitLab does not keep a level as a stage", async ({ page }) => {
    const keelson = await startKeelson({
      ...TREE,
      ".gitlab-ci.yml": "stages:\n  - build\n\ncompile:\n  stage: build\n  script:\n    - make\n",
    });
    try {
      await page.goto(keelson.url);
      await page.getByLabel("Pipeline file").selectOption(CI);
      await expect(page.locator("[data-job-id=test]")).toBeVisible();
      await page.getByLabel("Pipeline file").selectOption(".gitlab-ci.yml");
      await expect(page.locator("[data-job-id=compile]")).toBeVisible();
      await page.getByLabel("New job id").fill("lint");
      await page.getByLabel("Script").fill("make lint");
      await page.getByRole("button", { name: "Create job" }).click();
      await expect(page.locator("[data-job-id=lint]")).toBeVisible();
      expect(keelson.read()).toContain("lint:\n  stage: build\n");
    } finally {
      await keelson.stop();
    }
  });

  test("a job that depends on this one is not offered as a need", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.locator("[data-job-id=build]").click();
      await expect(page.getByRole("button", { name: "Add need" })).toBeDisabled();
    } finally {
      await keelson.stop();
    }
  });

  test("switching files is announced, groups name the provider", async ({ page }) => {
    const keelson = await startKeelson({
      ...TREE,
      ".gitlab-ci.yml": "compile:\n  stage: build\n  script:\n    - make\n",
    });
    try {
      await page.goto(keelson.url);
      await expect(page.locator("optgroup[label='GitHub Actions'] option")).toHaveCount(2);
      await page.getByLabel("Pipeline file").selectOption(CI);
      await expect(page.getByRole("status").filter({ hasText: `${CI} opened.` })).toBeVisible();
      await page.getByRole("button", { name: "Coverage" }).click();
      await expect(page.getByTestId("coverage-scope")).toContainText("1 of 3 pipeline files");
    } finally {
      await keelson.stop();
    }
  });

  test("a job's panel does not mention stages", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.locator("[data-job-id=build]").click();
      await expect(page.getByRole("region", { name: "Job detail" })).toBeVisible();
      await expect(page.getByTestId("job-stage")).toHaveCount(0);
    } finally {
      await keelson.stop();
    }
  });

  test("adding a need without options, and renaming updates needs", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.locator("[data-job-id=build]").click();
      await expect(page.getByRole("combobox", { name: "Stage", exact: true })).toHaveCount(0);
      await expect(page.getByLabel("Optional")).toHaveCount(0);
      await page.getByRole("textbox", { name: "Job id", exact: true }).fill("compile");
      await page.getByRole("button", { name: "Rename" }).click();
      await expect(page.locator("[data-job-id=compile]")).toBeVisible();
      await expect.poll(() => keelson.readAt(CI)).toContain("needs: compile");
    } finally {
      await keelson.stop();
    }
  });

  test("a local reusable workflow is read: the caller covers its jobs and the file is watched", async ({
    page,
  }) => {
    const SCANS = ".github/workflows/scans.yml";
    const keelson = await startKeelson({
      [CI]: [
        "on: push",
        "jobs:",
        "  scans:",
        "    uses: ./.github/workflows/scans.yml",
        "  deploy:",
        "    needs: scans",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: ./deploy",
        "",
      ].join("\n"),
      [SCANS]: [
        "on: workflow_call",
        "jobs:",
        "  leaks:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: gitleaks detect",
        "",
      ].join("\n"),
    });
    try {
      await page.goto(keelson.url);
      await page.getByLabel("Pipeline file").selectOption(CI);
      await expect(page.locator("[data-job-id=scans]")).toBeVisible();
      await expect(page.getByTestId("included-files-tag")).toHaveText("1 included file");
      await expect(page.getByRole("group", { name: "Partial pipeline" })).toHaveCount(0);

      await page.getByRole("button", { name: "Coverage" }).click();
      await expect(page.locator("[data-job-id=scans]")).toContainText("Secrets");

      keelson.writeAt(
        SCANS,
        "on: workflow_call\njobs:\n  sast:\n    runs-on: ubuntu-latest\n    steps:\n      - run: semgrep scan\n",
      );
      await expect(page.locator("[data-job-id=scans]")).toContainText("SAST");
      await expect(page.locator("[data-job-id=scans]")).not.toContainText("Secrets");
    } finally {
      await keelson.stop();
    }
  });
});
