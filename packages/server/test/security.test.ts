import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createToken, isAllowedHost, LOOPBACK, tokensMatch } from "../src/security.ts";
import { codeOf, startHarness } from "./support/harness.ts";

describe("createToken", () => {
  test("rend 32 octets en hexadécimal", () => {
    expect(createToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  test("ne rend jamais deux fois le même token", () => {
    const seen = new Set(Array.from({ length: 50 }, () => createToken()));
    expect(seen.size).toBe(50);
  });
});

describe("tokensMatch", () => {
  const token = createToken();

  test("accepte le token exact", () => {
    expect(tokensMatch(token, token)).toBe(true);
  });

  test("refuse un token différent de même longueur", () => {
    expect(tokensMatch(token, createToken())).toBe(false);
  });

  test("refuse un token plus court sans lever", () => {
    expect(tokensMatch(token, token.slice(0, 10))).toBe(false);
  });

  test("refuse un token plus long sans lever", () => {
    expect(tokensMatch(token, `${token}00`)).toBe(false);
  });

  test("refuse un token absent", () => {
    expect(tokensMatch(token, undefined)).toBe(false);
    expect(tokensMatch(token, "")).toBe(false);
  });

  test("refuse un token qui ne diffère que par la casse", () => {
    expect(tokensMatch(token, token.toUpperCase())).toBe(false);
  });
});

describe("isAllowedHost", () => {
  test("accepte 127.0.0.1 avec le bon port", () => {
    expect(isAllowedHost("127.0.0.1:5283", 5283)).toBe(true);
  });

  test("accepte localhost avec le bon port", () => {
    expect(isAllowedHost("localhost:5283", 5283)).toBe(true);
  });

  test("refuse un autre port", () => {
    expect(isAllowedHost("127.0.0.1:9999", 5283)).toBe(false);
  });

  test("refuse un hôte externe", () => {
    expect(isAllowedHost("exemple.org:5283", 5283)).toBe(false);
    expect(isAllowedHost("192.168.1.10:5283", 5283)).toBe(false);
    expect(isAllowedHost("keelson.localhost.exemple.org:5283", 5283)).toBe(false);
  });

  test("refuse un en-tête Host absent", () => {
    expect(isAllowedHost(undefined, 5283)).toBe(false);
  });

  test("refuse un hôte sans port", () => {
    expect(isAllowedHost("127.0.0.1", 5283)).toBe(false);
    expect(isAllowedHost("localhost", 5283)).toBe(false);
  });

  test("refuse l'IPv6 de bouclage, non prévue par le modèle", () => {
    expect(isAllowedHost("[::1]:5283", 5283)).toBe(false);
  });

  test("refuse un hôte qui se contente de commencer par 127.0.0.1", () => {
    expect(isAllowedHost("127.0.0.1.exemple.org:5283", 5283)).toBe(false);
  });

  test("l'interface d'écoute est le bouclage IPv4", () => {
    expect(LOOPBACK).toBe("127.0.0.1");
  });
});

describe("contrôles HTTP", () => {
  test("écoute sur 127.0.0.1 et nulle part ailleurs", async () => {
    const harness = await startHarness();
    expect(harness.server.url).toStartWith("http://127.0.0.1:");

    const address = harness.server.address();
    expect(address).toBe("127.0.0.1");
    await harness.close();
  });

  test("l'URL rendue porte le token en paramètre", async () => {
    const harness = await startHarness();
    expect(harness.server.url).toContain(`?token=${harness.server.token}`);
    await harness.close();
  });

  test("un en-tête Host étranger rend 403 avant tout traitement", async () => {
    const harness = await startHarness();
    const response = await harness.raw("/api/workspace", {
      headers: { host: "exemple.org:1234", "x-keelson-token": harness.server.token },
    });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("FORBIDDEN_HOST");
    await harness.close();
  });

  test("un Host étranger est refusé même sur une route inconnue", async () => {
    const harness = await startHarness();
    const response = await harness.raw("/n-importe-quoi", {
      headers: { host: "attaquant.example:1" },
    });
    expect(response.status).toBe(403);
    await harness.close();
  });

  test("un token absent rend 403", async () => {
    const harness = await startHarness();
    const response = await harness.raw("/api/workspace");
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("FORBIDDEN_TOKEN");
    await harness.close();
  });

  test("un token faux rend 403", async () => {
    const harness = await startHarness();
    const response = await harness.raw("/api/workspace", {
      headers: { "x-keelson-token": createToken() },
    });
    expect(response.status).toBe(403);
    await harness.close();
  });

  test("le bon token est accepté", async () => {
    const harness = await startHarness();
    expect((await harness.api("/api/workspace")).status).toBe(200);
    await harness.close();
  });

  test("le flux d'événements accepte le token en paramètre de requête", async () => {
    const harness = await startHarness();
    const response = await harness.raw(`/api/events?token=${harness.server.token}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await response.body?.cancel();
    await harness.close();
  });

  test("le flux d'événements sans token rend 403", async () => {
    const harness = await startHarness();
    const response = await harness.raw("/api/events");
    expect(response.status).toBe(403);
    await harness.close();
  });

  test("un chemin avec .. ne sort pas de la liste du workspace", async () => {
    const harness = await startHarness();
    for (const candidate of [
      "../../../etc/passwd",
      "..%2F..%2Fetc%2Fpasswd",
      encodeURIComponent("../.gitlab-ci.yml"),
      "%2e%2e%2f.gitlab-ci.yml",
    ]) {
      const response = await harness.api(`/api/documents/${candidate}`);
      expect(response.status).toBe(404);
    }
    await harness.close();
  });

  test("un fichier réel mais non détecté rend 404", async () => {
    const harness = await startHarness();
    writeFileSync(join(harness.root, "secret.yml"), "a: 1\n");
    expect((await harness.api("/api/documents/secret.yml")).status).toBe(404);
    await harness.close();
  });
});
