import { describe, expect, test } from "bun:test";
import { createToken, isAllowedHost, LOOPBACK, tokensMatch } from "../src/security.ts";

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
