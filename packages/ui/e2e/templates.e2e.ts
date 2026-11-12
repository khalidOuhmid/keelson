import { expect, test } from "@playwright/test";
import { startKeelson, type Tree } from "./support/server.ts";

const TREE: Tree = {
  ".gitlab-ci.yml": [
    "stages:",
    "  - build",
    "  - deploy",
    "",
    ".base: &base",
    "  image: alpine:3",
    "",
    ".docker:",
    "  extends: .base",
    "  services:",
    "    - docker:27-dind",
    "",
    "compile:",
    "  extends: .docker",
    "  stage: build",
    "  script:",
    "    - make",
    "",
    "ship:",
    "  <<: *base",
    "  stage: deploy",
    "  script:",
    "    - ./ship.sh",
    "",
  ].join("\n"),
};

type Box = { left: number; right: number; top: number; bottom: number };

test("template-to-template extends and merge-key links are drawn, each of its own kind", async ({
  page,
}) => {
  const keelson = await startKeelson(TREE);
  try {
    await page.goto(keelson.url);
    await expect(page.getByRole("group", { name: "Templates" })).toContainText("2 templates");
    await expect(page.locator('[data-job-id="ship"]')).toBeVisible();

    const drawn = await page.evaluate(() => {
      const box = (selector: string): Box | null => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect === undefined
          ? null
          : { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      };
      const edges = [...document.querySelectorAll<SVGGElement>(".react-flow__edge")].map((edge) => {
        const path = edge.querySelector<SVGPathElement>(".react-flow__edge-path");
        const length = path?.getTotalLength() ?? 0;
        const start = path?.getPointAtLength(0);
        const end = path?.getPointAtLength(length);
        const matrix = path?.getScreenCTM();
        const toScreen = (point: DOMPoint | undefined) =>
          point === undefined || matrix == null ? null : point.matrixTransform(matrix);
        return {
          label: edge.getAttribute("aria-label"),
          text: edge.querySelector(".react-flow__edge-text")?.textContent ?? null,
          dash: path === null ? null : getComputedStyle(path).strokeDasharray,
          start: toScreen(start),
          end: toScreen(end),
        };
      });
      return {
        base: box('[data-template-id=".base"]'),
        docker: box('[data-template-id=".docker"]'),
        build: box('[aria-label="Stage build"]'),
        edges: edges.map((edge) => ({
          ...edge,
          start: edge.start === null ? null : { x: edge.start.x, y: edge.start.y },
          end: edge.end === null ? null : { x: edge.end.x, y: edge.end.y },
        })),
      };
    });

    expect(drawn.base?.right ?? 0).toBeLessThanOrEqual(drawn.docker?.left ?? 0);
    expect(drawn.docker?.right ?? 0).toBeLessThanOrEqual(drawn.build?.left ?? 0);

    const labels = drawn.edges.map((edge) => edge.label);
    expect(labels).toContain(".docker extends .base");
    expect(labels).toContain("compile extends .docker");
    expect(labels).toContain("ship merges .base");

    const chain = drawn.edges.find((edge) => edge.label === ".docker extends .base");
    const merge = drawn.edges.find((edge) => edge.label === "ship merges .base");
    const extended = drawn.edges.find((edge) => edge.label === "compile extends .docker");

    // The chain edge really runs from the parent's right side into the child's left side.
    expect(Math.abs((chain?.start?.x ?? 0) - (drawn.base?.right ?? 0))).toBeLessThanOrEqual(12);
    expect(Math.abs((chain?.end?.x ?? 0) - (drawn.docker?.left ?? 0))).toBeLessThanOrEqual(12);

    expect(merge?.text).toBe("merge");
    expect(extended?.text).toBeNull();
    expect(merge?.dash).not.toBe(extended?.dash);
    expect(merge?.dash).not.toBe("none");
    expect(extended?.dash).not.toBe("none");
  } finally {
    await keelson.stop();
  }
});
