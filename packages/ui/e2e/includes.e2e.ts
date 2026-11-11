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

test.describe("local includes on the real binary", () => {
  test("jobs from an included file are drawn, and marked read-only", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);

      const sast = page.locator('[data-job-id="sast"]');
      await expect(sast).toBeVisible();
      await expect(sast).toHaveAttribute("data-included", "true");
      await expect(sast).toContainText("read-only");

      // The main file's job carries no mark: the negative assertion is what stops a mark
      // applied to every node from passing as a success.
      const compile = page.locator('[data-job-id="compile"]');
      await expect(compile).toHaveAttribute("data-included", "false");
      await expect(compile).not.toContainText("read-only");
    } finally {
      await keelson.stop();
    }
  });

  test("the partial pipeline indicator names the unresolved include", async ({ page }) => {
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

  /** What this test measures: the screen offers no control on an included job, and the file is
   *  intact after the walkthrough. Re-reading the disk is a **safeguard**, not the main
   *  measure: no control, hence no request, hence nothing would write anyway.
   *  The byte guarantee against a request actually sent is measured in
   *  `packages/server/test/includes.test.ts`, where the server really writes. */
  test("an included job cannot be edited, and its file stays intact", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.locator('[data-job-id="sast"]').click();

      await expect(page.getByTestId("job-source-file")).toContainText(INCLUDED_PATH);

      await expect(page.getByText("This job is defined in an included file.")).toBeVisible();
      await expect(page.getByRole("group", { name: "Job editor" })).toHaveCount(0);

      expect(keelson.readAt(INCLUDED_PATH)).toBe(INCLUDED);
    } finally {
      await keelson.stop();
    }
  });

  test("an included job's opaque block shows the bytes of its file", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await page.locator('[data-job-id="sast"]').click();

      const block = page.getByRole("group", { name: "Opaque block script" });
      // `make scan` only exists in the included file; the main file contains `make`.
      await expect(block).toContainText("make scan");
    } finally {
      await keelson.stop();
    }
  });

  /** The watcher must follow included files: otherwise the screen stays on a stale pipeline
   *  after a colleague touched `ci/jobs.yml`, and nothing says so. */
  test("editing an included file updates the screen", async ({ page }) => {
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

  test("stage controls stay active: the list comes from the main file", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      await expect(page.getByRole("button", { name: /^Add stage$/ })).toBeEnabled();
    } finally {
      await keelson.stop();
    }
  });
});

test("expanded, the partial banner does not swallow the screen", async ({ page }) => {
  // Measured during `polish`: with 31 unresolved includes, 729 px out of 800, and 2751 px at 375
  // wide. A percentage bound only holds on an element whose parent has a height.
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
      throw new Error("banner or viewport without geometry");
    }
    expect(box.height).toBeLessThanOrEqual(viewport.height / 3 + 1);
  } finally {
    await keelson.stop();
  }
});

test.describe("the partial banner from the keyboard, in a real browser", () => {
  /** `happy-dom` does not implement the native `<details>` toggle on Enter: the unit test
   *  can only measure that the summary is focusable. Expanding can only be checked in a
   *  real browser, which is here. */
  test("the summary expands and collapses on Enter", async ({ page }) => {
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

  test("the included node no longer has a title, and its mark stays readable", async ({ page }) => {
    const keelson = await startKeelson(TREE);
    try {
      await page.goto(keelson.url);
      const sast = page.locator('[data-job-id="sast"]');
      // A `title` appears nowhere in the accessibility tree when an
      // `aria-describedby` is present: two wordings of the same fact, only one ever read.
      await expect(sast).not.toHaveAttribute("title", /./);
      await expect(sast).toContainText("read-only");
    } finally {
      await keelson.stop();
    }
  });

  test("the header announces the number of resolved included files", async ({ page }) => {
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
