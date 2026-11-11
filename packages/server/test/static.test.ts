import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Harness, startHarness } from "./support/harness.ts";

let ui = "";
let harness: Harness;

beforeAll(async () => {
  ui = mkdtempSync(join(tmpdir(), "keelson-ui-"));
  writeFileSync(join(ui, "index.html"), "<!doctype html><title>Keelson</title>");
  mkdirSync(join(ui, "assets"));
  writeFileSync(join(ui, "assets", "app.js"), "console.log(1)");
  mkdirSync(join(ui, "folder"));
  if (process.platform !== "win32") {
    execFileSync("mkfifo", [join(ui, "assets", "pipe.js")]);
  }
  harness = await startHarness({ uiDir: ui });
});

afterAll(async () => {
  await harness.close();
  rmSync(ui, { recursive: true, force: true });
});

describe("the UI bundle", () => {
  test("serves a file with its content type", async () => {
    const response = await harness.raw("/assets/app.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.text()).toBe("console.log(1)");
  });

  test("falls back to index.html for an unknown path, never cached", async () => {
    const response = await harness.raw("/pipeline/view");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("<title>Keelson</title>");
  });

  test("a directory is not served as a file", async () => {
    const response = await harness.raw("/folder");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("<title>Keelson</title>");
  });

  test("a path that climbs out of the bundle gets index.html, not the file", async () => {
    const response = await harness.raw("/../../etc/passwd");
    expect(await response.text()).toContain("<title>Keelson</title>");
  });

  test.skipIf(process.platform === "win32")(
    "a FIFO is not served and does not block the server",
    async () => {
      const response = await harness.raw("/assets/pipe.js");
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await response.text()).toContain("<title>Keelson</title>");
    },
    3000,
  );
});
