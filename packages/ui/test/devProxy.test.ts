import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const viteConfig = readFileSync(join(repoRoot, "packages", "ui", "vite.config.ts"), "utf8");
const devScript = readFileSync(join(repoRoot, "scripts", "dev.ts"), "utf8");

function constantOf(source: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]+)"`).exec(source);
  return match?.[1] ?? null;
}

function portOf(source: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(source);
  return match?.[1] ?? null;
}

describe("dev proxy consistency", () => {
  test("Vite proxies /api", () => {
    expect(viteConfig).toContain('"/api"');
  });

  test("the proxy adds the token header", () => {
    expect(viteConfig).toContain("x-keelson-token");
  });

  test("the proxy token is the dev server's", () => {
    const fromScript = constantOf(devScript, "DEV_TOKEN");
    const fromVite = constantOf(viteConfig, "DEV_TOKEN");
    expect(fromScript).not.toBeNull();
    expect(fromVite).toBe(fromScript);
  });

  test("the proxy target port is the dev server's", () => {
    const port = portOf(devScript, "DEV_API_PORT");
    expect(port).not.toBeNull();
    expect(viteConfig).toContain(`127.0.0.1:${port}`);
  });

  test("changeOrigin is on, otherwise the server's Host check would reject the request", () => {
    expect(viteConfig).toContain("changeOrigin");
  });

  test("Vite listens on the documented dev port", () => {
    expect(viteConfig).toContain("port: 5283");
  });

  test("the dev server runs on the dev fixture", () => {
    expect(devScript).toContain("dev-fixture");
  });
});
