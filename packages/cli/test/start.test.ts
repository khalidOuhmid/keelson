import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer as createRawServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type StartDeps, startCommand } from "../src/start.ts";

const SAMPLE = [
  "stages:",
  "  - build",
  "",
  "compile:",
  "  stage: build",
  "  script:",
  "    - make",
  "",
].join("\n");

function workspace(withFile = true): string {
  const root = mkdtempSync(join(tmpdir(), "keelson-start-"));
  if (withFile) {
    writeFileSync(join(root, ".gitlab-ci.yml"), SAMPLE);
  }
  return root;
}

type Harness = {
  opened: string[];
  written: string[];
  shutdown: () => void;
  deps: StartDeps;
};

function harness(): Harness {
  const opened: string[] = [];
  const written: string[] = [];
  let release = (): void => undefined;
  const stop = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    opened,
    written,
    shutdown: () => release(),
    deps: {
      open: (url) => opened.push(url),
      write: (chunk) => written.push(chunk),
      waitForShutdown: () => stop,
    },
  };
}

function urlFrom(written: readonly string[]): string {
  const line = written.join("").trim();
  const match = /(http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]{64})/.exec(line);
  if (match?.[1] === undefined) {
    throw new Error(`URL not found in output: ${line}`);
  }
  return match[1];
}

describe("startup", () => {
  test("announces the URL with the port and token, then exits 0", async () => {
    const h = harness();
    const run = startCommand([workspace()], process.cwd(), h.deps);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(h.written.join("")).toContain("Keelson running at http://127.0.0.1:");
    const url = urlFrom(h.written);

    h.shutdown();
    const result = await run;
    expect(result.exitCode).toBe(0);
    expect(url).toContain("?token=");
  });

  test("the server answers /api/workspace with the token", async () => {
    const h = harness();
    const run = startCommand([workspace()], process.cwd(), h.deps);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const url = new URL(urlFrom(h.written));
    const response = await fetch(`${url.origin}/api/workspace`, {
      headers: { "x-keelson-token": url.searchParams.get("token") ?? "" },
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toEqual({
      files: [{ path: ".gitlab-ci.yml", adapter: "gitlab" }],
    });

    h.shutdown();
    await run;
  });

  test("without a token the request is refused", async () => {
    const h = harness();
    const run = startCommand([workspace()], process.cwd(), h.deps);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const url = new URL(urlFrom(h.written));
    expect((await fetch(`${url.origin}/api/workspace`)).status).toBe(403);

    h.shutdown();
    await run;
  });

  test("starts even with no CI file detected", async () => {
    const h = harness();
    const run = startCommand([workspace(false)], process.cwd(), h.deps);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const url = new URL(urlFrom(h.written));
    const response = await fetch(`${url.origin}/api/workspace`, {
      headers: { "x-keelson-token": url.searchParams.get("token") ?? "" },
    });
    expect((await response.json()) as unknown).toEqual({ files: [] });

    h.shutdown();
    expect((await run).exitCode).toBe(0);
  });

  test("uses the current directory when none is passed", async () => {
    const root = workspace();
    const h = harness();
    const run = startCommand([], root, h.deps);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const url = new URL(urlFrom(h.written));
    const response = await fetch(`${url.origin}/api/workspace`, {
      headers: { "x-keelson-token": url.searchParams.get("token") ?? "" },
    });
    expect(((await response.json()) as { files: unknown[] }).files).toHaveLength(1);

    h.shutdown();
    await run;
  });
});

describe("opening the browser", () => {
  test("opens the URL by default", async () => {
    const h = harness();
    const run = startCommand([workspace()], process.cwd(), h.deps);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(h.opened).toHaveLength(1);
    expect(h.opened[0]).toBe(urlFrom(h.written));

    h.shutdown();
    await run;
  });

  test("--no-open does not call the opener", async () => {
    const h = harness();
    const run = startCommand([workspace(), "--no-open"], process.cwd(), h.deps);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(h.opened).toEqual([]);

    h.shutdown();
    expect((await run).exitCode).toBe(0);
  });
});

describe("port", () => {
  test("--port forces the requested port", async () => {
    const h = harness();
    const run = startCommand([workspace(), "--port", "5391"], process.cwd(), h.deps);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(h.written.join("")).toContain("http://127.0.0.1:5391/");

    h.shutdown();
    await run;
  });

  test("a busy port returns 2 with a clear message", async () => {
    const squatter = createRawServer();
    await new Promise<void>((resolve) => squatter.listen(0, "127.0.0.1", () => resolve()));
    const address = squatter.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;

    const h = harness();
    const result = await startCommand([workspace(), "--port", String(port)], process.cwd(), h.deps);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(String(port));
    expect(h.opened).toEqual([]);

    await new Promise<void>((resolve) => squatter.close(() => resolve()));
  });

  test("a non-numeric port returns 2", async () => {
    const h = harness();
    const result = await startCommand([workspace(), "--port", "abc"], process.cwd(), h.deps);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--port");
  });

  test("an out-of-range port returns 2", async () => {
    const h = harness();
    for (const port of ["-1", "70000"]) {
      const result = await startCommand([workspace(), "--port", port], process.cwd(), h.deps);
      expect(result.exitCode).toBe(2);
    }
  });
});

describe("invalid usage", () => {
  test("an unknown option returns 2", async () => {
    const h = harness();
    const result = await startCommand([workspace(), "--turbo"], process.cwd(), h.deps);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--turbo");
  });

  test("two directories return 2", async () => {
    const h = harness();
    const result = await startCommand([workspace(), workspace()], process.cwd(), h.deps);
    expect(result.exitCode).toBe(2);
  });

  test("a nonexistent directory returns 2", async () => {
    const h = harness();
    const result = await startCommand(
      [join(tmpdir(), "keelson-absent-xyz")],
      process.cwd(),
      h.deps,
    );
    expect(result.exitCode).toBe(2);
  });
});

describe("shutdown", () => {
  test("shutting down closes the server", async () => {
    const h = harness();
    const run = startCommand([workspace()], process.cwd(), h.deps);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const url = new URL(urlFrom(h.written));

    h.shutdown();
    expect((await run).exitCode).toBe(0);

    await expect(
      fetch(`${url.origin}/api/workspace`, {
        headers: { "x-keelson-token": url.searchParams.get("token") ?? "" },
      }),
    ).rejects.toThrow();
  });
});
