import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createToken, isAllowedHost, LOOPBACK, tokensMatch } from "../src/security.ts";
import { codeOf, startHarness } from "./support/harness.ts";

describe("createToken", () => {
  test("returns 32 bytes in hexadecimal", () => {
    expect(createToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  test("never returns the same token twice", () => {
    const seen = new Set(Array.from({ length: 50 }, () => createToken()));
    expect(seen.size).toBe(50);
  });
});

describe("tokensMatch", () => {
  const token = createToken();

  test("accepts the exact token", () => {
    expect(tokensMatch(token, token)).toBe(true);
  });

  test("refuses a different token of the same length", () => {
    expect(tokensMatch(token, createToken())).toBe(false);
  });

  test("refuses a shorter token without throwing", () => {
    expect(tokensMatch(token, token.slice(0, 10))).toBe(false);
  });

  test("refuses a longer token without throwing", () => {
    expect(tokensMatch(token, `${token}00`)).toBe(false);
  });

  test("refuses a missing token", () => {
    expect(tokensMatch(token, undefined)).toBe(false);
    expect(tokensMatch(token, "")).toBe(false);
  });

  test("refuses a token that differs only in case", () => {
    expect(tokensMatch(token, token.toUpperCase())).toBe(false);
  });
});

describe("isAllowedHost", () => {
  test("accepts 127.0.0.1 with the right port", () => {
    expect(isAllowedHost("127.0.0.1:5283", 5283)).toBe(true);
  });

  test("accepts localhost with the right port", () => {
    expect(isAllowedHost("localhost:5283", 5283)).toBe(true);
  });

  test("refuses another port", () => {
    expect(isAllowedHost("127.0.0.1:9999", 5283)).toBe(false);
  });

  test("refuses an external host", () => {
    expect(isAllowedHost("exemple.org:5283", 5283)).toBe(false);
    expect(isAllowedHost("192.168.1.10:5283", 5283)).toBe(false);
    expect(isAllowedHost("keelson.localhost.exemple.org:5283", 5283)).toBe(false);
  });

  test("refuses a missing Host header", () => {
    expect(isAllowedHost(undefined, 5283)).toBe(false);
  });

  test("refuses a host without a port", () => {
    expect(isAllowedHost("127.0.0.1", 5283)).toBe(false);
    expect(isAllowedHost("localhost", 5283)).toBe(false);
  });

  test("refuses the IPv6 loopback, not covered by the model", () => {
    expect(isAllowedHost("[::1]:5283", 5283)).toBe(false);
  });

  test("refuses a host that merely starts with 127.0.0.1", () => {
    expect(isAllowedHost("127.0.0.1.exemple.org:5283", 5283)).toBe(false);
  });

  test("the listening interface is the IPv4 loopback", () => {
    expect(LOOPBACK).toBe("127.0.0.1");
  });
});

describe("HTTP checks", () => {
  test("listens on 127.0.0.1 and nowhere else", async () => {
    const harness = await startHarness();
    expect(harness.server.url).toStartWith("http://127.0.0.1:");

    const address = harness.server.address();
    expect(address).toBe("127.0.0.1");
    await harness.close();
  });

  test("the returned URL carries the token as a parameter", async () => {
    const harness = await startHarness();
    expect(harness.server.url).toContain(`?token=${harness.server.token}`);
    await harness.close();
  });

  test("a foreign Host header returns 403 before any processing", async () => {
    const harness = await startHarness();
    const response = await harness.raw("/api/workspace", {
      headers: { host: "exemple.org:1234", "x-keelson-token": harness.server.token },
    });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("FORBIDDEN_HOST");
    await harness.close();
  });

  test("a foreign Host is refused even on an unknown route", async () => {
    const harness = await startHarness();
    const response = await harness.raw("/n-importe-quoi", {
      headers: { host: "attaquant.example:1" },
    });
    expect(response.status).toBe(403);
    await harness.close();
  });

  test("a missing token returns 403", async () => {
    const harness = await startHarness();
    const response = await harness.raw("/api/workspace");
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("FORBIDDEN_TOKEN");
    await harness.close();
  });

  test("a wrong token returns 403", async () => {
    const harness = await startHarness();
    const response = await harness.raw("/api/workspace", {
      headers: { "x-keelson-token": createToken() },
    });
    expect(response.status).toBe(403);
    await harness.close();
  });

  test("the right token is accepted", async () => {
    const harness = await startHarness();
    expect((await harness.api("/api/workspace")).status).toBe(200);
    await harness.close();
  });

  test("the event stream accepts the token as a query parameter", async () => {
    const harness = await startHarness();
    const response = await harness.raw(`/api/events?token=${harness.server.token}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await response.body?.cancel();
    await harness.close();
  });

  test("the event stream without a token returns 403", async () => {
    const harness = await startHarness();
    const response = await harness.raw("/api/events");
    expect(response.status).toBe(403);
    await harness.close();
  });

  test("a path with .. does not escape the workspace list", async () => {
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

  test("a real but undetected file returns 404", async () => {
    const harness = await startHarness();
    writeFileSync(join(harness.root, "secret.yml"), "a: 1\n");
    expect((await harness.api("/api/documents/secret.yml")).status).toBe(404);
    await harness.close();
  });
});
