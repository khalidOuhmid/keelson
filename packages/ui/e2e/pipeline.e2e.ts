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

test("shows the fixture's stages, jobs and origin badges", async ({ page }) => {
  await open(page);

  for (const stage of ["build", "test", "scan", "deploy"]) {
    await expect(page.getByTestId("stage-column-name").filter({ hasText: stage })).toBeVisible();
  }

  for (const job of ["build-image", "unit-tests", "secret-detection", "deploy-production"]) {
    await expect(page.getByRole("button", { name: new RegExp(job) })).toBeVisible();
  }

  await expect(page.getByText("inherited from .deploy-base").first()).toBeVisible();
});

test("the token is removed from the URL after loading", async ({ page }) => {
  await open(page);
  expect(page.url()).not.toContain("token=");
});

test("renaming a job writes the file to disk", async ({ page }) => {
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

test("adding a need writes the file and appears in the panel", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: /^lint/ }).click();
  await page.getByRole("combobox", { name: "Add a need" }).selectOption("build-image");
  await page.getByRole("button", { name: "Add need" }).click();

  await expect(page.getByRole("button", { name: "Remove need build-image" })).toBeVisible();
  expect(keelson.read()).toMatch(/lint:[\s\S]*needs:[\s\S]*build-image/);
});

test("after a write, the notice names the line it changed in the file", async ({ page }) => {
  await open(page);
  await page.getByRole("textbox", { name: "New stage name" }).fill("verify");
  await page.getByRole("button", { name: "Add stage" }).click();

  const notice = page.getByRole("status").filter({ hasText: "Changed line" });
  await expect(notice).toBeVisible();
  const line =
    keelson
      .read()
      .split("\n")
      .findIndex((entry) => entry.includes("verify")) + 1;
  expect(line).toBeGreaterThan(0);
  await expect(notice).toHaveText(new RegExp(`Changed line ${line} of \\.gitlab-ci\\.yml\\.`));
});

test("cancelling an inherited environment writes environment: null and leaves the template", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: /deploy-production/ }).click();
  await page.getByRole("button", { name: "Cancel inherited environment" }).click();

  await expect(page.getByRole("button", { name: "Cancel inherited environment" })).toHaveCount(0);
  const text = keelson.read();
  expect(text.slice(text.indexOf("deploy-production:"))).toContain("environment: null");
  expect(text).toContain(".deploy-base:\n  stage: deploy\n  environment:\n    name: production");
});

test("undo restores the original bytes", async ({ page }) => {
  await open(page);
  const original = keelson.read();

  await page.getByRole("textbox", { name: "New stage name" }).fill("verify");
  await page.getByRole("button", { name: "Add stage" }).click();

  await expect(page.getByTestId("stage-column-name").filter({ hasText: "verify" })).toBeVisible();
  expect(keelson.read()).not.toBe(original);

  await page.getByRole("button", { name: "Undo" }).click();
  // Undo is disabled as soon as the write leaves: only Redo says that it landed.
  await expect(page.getByRole("button", { name: "Redo" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  expect(keelson.read()).toBe(original);
});

test("an external change to the file reloads the UI", async ({ page }) => {
  await open(page);

  keelson.write(`${keelson.read()}\nvenu-du-dehors:\n  stage: build\n  script:\n    - echo\n`);

  await expect(page.getByRole("button", { name: /venu-du-dehors/ })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("notice-kind")).toContainText("Reloaded");
});

test("deleting the file shows the deleted state", async ({ page }) => {
  await open(page);

  const { rmSync } = await import("node:fs");
  rmSync(keelson.file);

  await expect(page.getByRole("heading", { name: /deleted/i })).toBeVisible({ timeout: 10_000 });
});

test("a 409 says in English that nothing was applied, reloads and clears history", async ({
  page,
}) => {
  await page.route("**/api/events*", (route) => route.abort());
  await open(page);

  await page.getByRole("textbox", { name: "New stage name" }).fill("verify");
  await page.getByRole("button", { name: "Add stage" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

  keelson.write(`${keelson.read()}\nhors-keelson:\n  stage: build\n  script:\n    - echo\n`);

  await page.getByRole("textbox", { name: "New stage name" }).fill("publish");
  await page.getByRole("button", { name: "Add stage" }).click();

  await expect(page.getByTestId("notice-kind")).toContainText("Not applied");
  // This test's title promised "the message" without ever asserting it — caught by the
  // 2026-10-22 review. Since the server no longer sends a sentence, this is the only place where
  // the 409 rendering on the real binary is checked.
  // Two `role="alert"` coexist on this path: the notice banner, whose text is hard-coded in the
  // UI, and the error banner, which renders the server's. We want the second, targeted by the
  // code it shows — `.first()` would pick the notice and the test would pass without anything
  // being rendered from `code` + `params`.
  const banner = page.getByRole("alert").filter({ hasText: "STALE_DOCUMENT" });
  await expect(banner).toContainText("the document changed since the operation was computed");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  expect(keelson.read()).not.toContain("publish");
});

test("a domain error shows the English text rendered from the server's code", async ({ page }) => {
  await open(page);

  await page.getByRole("textbox", { name: "New stage name" }).fill("build");
  await page.getByRole("button", { name: "Add stage" }).click();

  await expect(page.getByText("STAGE_EXISTS")).toBeVisible();
  // The server no longer sends a sentence: without client-side rendering, the banner would only
  // show the code. The exact text is therefore what proves `render()` ran.
  await expect(page.getByRole("alert")).toContainText('stage "build" already exists');
});

test("deleting a referenced job shows the English sentence and the referrers", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: /build-image/ }).click();
  await page.getByRole("button", { name: "Delete job" }).click();
  await page.getByRole("button", { name: "Delete build-image" }).click();

  await expect(page.getByText("JOB_REFERENCED")).toBeVisible();
  const banner = page.getByRole("alert");
  const referents = ["unit-tests", "secret-detection", "container-scan"];
  await expect(banner).toContainText(`job "build-image" is needed by ${referents.join(", ")}`);
  // The chips are a path separate from the sentence: they come from `params.referencedBy`, not
  // from rendering. The list is exact, not a subset — a referrer missing on screen is a job the
  // user will think they can keep.
  await expect(banner.getByRole("listitem")).toHaveText(referents);
});

test("clicking a diagnostic selects the job concerned", async ({ page }) => {
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

test("layout invariants: every job is in the column of the stage it declares", async ({ page }) => {
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

  // The dev fixture has `lint`, a job with no edge in a late stage: that is the shape that used
  // to land a job in the previous stage's column.
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

test("no edge is a tab stop", async ({ page }) => {
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

test("the detail panel closes from the keyboard", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: /^lint/ }).click();
  await expect(page.getByRole("region", { name: "Job detail" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Job detail" })).toBeHidden();

  await page.getByRole("button", { name: /^lint/ }).click();
  await page.getByRole("button", { name: "Close job detail" }).click();
  await expect(page.getByRole("region", { name: "Job detail" })).toBeHidden();
});

test("deleting a job asks for confirmation before writing to disk", async ({ page }) => {
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

test("at 320 px the graph stays rendered and measurable", async ({ page }) => {
  // WCAG 1.4.10: 320 px is a 400% zoom on a 1280 px laptop. Before the fix, the two `shrink-0`
  // columns squashed `<main>` to zero and the canvas was not rendered at all.
  await page.setViewportSize({ width: 320, height: 800 });
  await open(page);
  await expect(page.getByRole("button", { name: /^lint/ })).toBeVisible();

  const width = await page
    .getByRole("region", { name: "Pipeline graph" })
    .evaluate((element) => element.getBoundingClientRect().width);

  expect(width).toBeGreaterThan(0);
});

test("selecting a job visually sets its edges apart", async ({ page }) => {
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

test("the origin badge does not alter the case of the file's identifier", async ({ page }) => {
  // `.deploy-base` is a GitLab template key, case-sensitive and written by the user. Showing it
  // as `.DEPLOY-BASE` is data rewritten on screen. Only Keelson's voice — "inherited from" — is
  // set in small caps.
  await open(page);
  await page.getByRole("button", { name: /deploy-production/ }).click();

  // The panel's badge, not the canvas one: it is the one nested in a small-caps heading, hence
  // the only one that can inherit a `text-transform`.
  const badge = page
    .getByRole("region", { name: "Job detail" })
    .getByTestId("origin-badge")
    .first();
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

test("the graph refits when the detail panel opens", async ({ page }) => {
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

  // Before the fix, `fitView` only ran on mount: opening the panel took 352px from the canvas
  // without refitting it, and the last column slid under the panel.
  await expect.poll(rightmostColumn).toBeLessThanOrEqual(panelLeft + 1);
});

test("an opaque block still shows its own bytes after an edit", async ({ page }) => {
  // Found by the independent review: `applyPayload` did not refresh `text`, while opaque block
  // ranges come from the new pipeline. After an operation shifting offsets, the block showed a
  // fragment overlapping another job's key — on the only surface whose written guarantee is
  // "this is intact".
  await open(page);

  const blockText = async () => {
    await page.getByRole("button", { name: /container-scan/ }).click();
    await expect(page.getByRole("region", { name: "Job detail" })).toBeVisible();
    return (await page.getByRole("group", { name: "Opaque block script" }).textContent()) ?? "";
  };

  const before = await blockText();
  expect(before).toContain("trivy");

  // A markedly longer rename shifts every offset after it.
  await page.getByRole("button", { name: /^lint/ }).click();
  await page
    .getByRole("textbox", { name: "Job id", exact: true })
    .fill("lint-with-a-much-longer-name");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("button", { name: /lint-with-a-much-longer-name/ })).toBeVisible();

  const after = await blockText();
  expect(after).toContain("trivy");
  expect(after).not.toContain("deploy-production");
  expect(after).toBe(before);
});

test("every edge exposes its dependency as accessible text", async ({ page }) => {
  // Second review: `ariaLabel` was only tested as an object value, while it is the graph's only
  // accessible description. An xyflow upgrade that stopped setting `role` and `aria-label` on
  // non-focusable edges would go unnoticed.
  await open(page);
  await expect(page.getByRole("button", { name: /lint/ })).toBeVisible();

  const labels = await page.evaluate(() =>
    [...document.querySelectorAll(".react-flow__edge")].map((edge) => ({
      role: edge.getAttribute("role"),
      label: edge.getAttribute("aria-label"),
    })),
  );

  expect(labels.length).toBeGreaterThan(0);
  expect(labels.every((edge) => edge.role === "img")).toBe(true);
  expect(labels.map((edge) => edge.label)).toContain("unit-tests needs build-image");
});
