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

describe("cohérence du proxy de développement", () => {
  test("Vite proxifie /api", () => {
    expect(viteConfig).toContain('"/api"');
  });

  test("le proxy ajoute l'en-tête du token", () => {
    expect(viteConfig).toContain("x-keelson-token");
  });

  test("le token du proxy est celui du serveur de dev", () => {
    const fromScript = constantOf(devScript, "DEV_TOKEN");
    const fromVite = constantOf(viteConfig, "DEV_TOKEN");
    expect(fromScript).not.toBeNull();
    expect(fromVite).toBe(fromScript);
  });

  test("le port cible du proxy est celui du serveur de dev", () => {
    const port = portOf(devScript, "DEV_API_PORT");
    expect(port).not.toBeNull();
    expect(viteConfig).toContain(`127.0.0.1:${port}`);
  });

  test("changeOrigin est actif, sans quoi le contrôle de Host du serveur refuserait la requête", () => {
    expect(viteConfig).toContain("changeOrigin");
  });

  test("Vite écoute sur le port de dev documenté", () => {
    expect(viteConfig).toContain("port: 5283");
  });

  test("le serveur de dev tourne sur la fixture de dev", () => {
    expect(devScript).toContain("dev-fixture");
  });
});
