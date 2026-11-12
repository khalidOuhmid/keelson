import { describe, expect, test } from "bun:test";
import { parseToolchain } from "../src/index.ts";

const FULL = `# plateforme
version: 1
services:
  nexus-prod:
    tool: nexus
    url: https://nexus.example.org
    environment: production
  vault:
    tool: vault
integrations:
  - job: build
    service: nexus-prod
    kind: push
dismissed:
  - job: scan
    tool: sentry
    kind: notify
`;

describe("reading toolchain.yaml", () => {
  test("a missing or empty file is an empty toolchain, without diagnostics", () => {
    for (const text of [null, "", "# nothing\n"]) {
      expect(parseToolchain(text)).toEqual({
        toolchain: { services: [], integrations: [], dismissed: [] },
        diagnostics: [],
      });
    }
  });

  test("the three sections, in file order", () => {
    const { toolchain, diagnostics } = parseToolchain(FULL);
    expect(diagnostics).toEqual([]);
    expect(toolchain.services).toEqual([
      {
        id: "nexus-prod",
        tool: "nexus",
        url: "https://nexus.example.org",
        environment: "production",
      },
      { id: "vault", tool: "vault", url: null, environment: null },
    ]);
    expect(toolchain.integrations).toEqual([{ job: "build", service: "nexus-prod", kind: "push" }]);
    expect(toolchain.dismissed).toEqual([{ job: "scan", tool: "sentry", kind: "notify" }]);
  });

  test("a service id is the key's text: `007` and `0x10` stay as written", () => {
    const { toolchain, diagnostics } = parseToolchain(
      "version: 1\nservices:\n  007:\n    tool: x\n  0x10:\n    tool: y\n  7:\n    tool: z\n",
    );
    expect(diagnostics).toEqual([]);
    expect(toolchain.services.map((service) => service.id)).toEqual(["007", "0x10", "7"]);
  });

  test("services keep file order, integer keys included", () => {
    const { toolchain } = parseToolchain(
      "version: 1\nservices:\n  b:\n    tool: x\n  8080:\n    tool: y\n",
    );
    expect(toolchain.services.map((service) => service.id)).toEqual(["b", "8080"]);
  });

  test('`~` and `"null"` are two keys: `~` is reported as unusable, not as a duplicate', () => {
    const { diagnostics } = parseToolchain(
      'version: 1\nservices:\n  ~:\n    tool: x\n  "null":\n    tool: y\n',
    );
    expect(diagnostics[0]?.params).toEqual({ detail: "services: ~ is not a usable service id" });
  });

  test("a quoted key and the same plain text are the same id", () => {
    const { diagnostics } = parseToolchain(
      'version: 1\nservices:\n  null:\n    tool: x\n  "null":\n    tool: y\n',
    );
    expect(JSON.stringify(diagnostics[0]?.params)).toContain("Map keys must be unique");
  });

  test("an invalid service is reported under its written id", () => {
    const { diagnostics } = parseToolchain("version: 1\nservices:\n  007:\n    url: x\n");
    expect(JSON.stringify(diagnostics[0]?.params)).toContain('"detail":"services.007.tool: ');
  });

  test("an empty section equals a missing section", () => {
    expect(parseToolchain("version: 1\nservices:\nintegrations: []\n").diagnostics).toEqual([]);
  });

  test.each([
    ["broken YAML", "version: 1\nservices: [\n"],
    ["alias without anchor", "*x\n"],
    ["duplicate key", "version: 1\nversion: 1\n"],
    ["missing version", "services: {}\n"],
    ["unknown version", "version: 2\n"],
    ["scalar root", "hello\n"],
    ["illegal id", "version: 1\nservices:\n  __proto__:\n    tool: x\n"],
    ["unknown integration kind", "version: 1\nintegrations:\n  - {job: a, service: b, kind: x}\n"],
    ["unknown key", "version: 1\nunexpected: 1\n"],
    [
      "two keys with the same text",
      'version: 1\nservices:\n  8080:\n    tool: a\n  "8080":\n    tool: b\n',
    ],
  ])("%s yields TOOLCHAIN_INVALID and an empty toolchain", (_label, text) => {
    const { toolchain, diagnostics } = parseToolchain(text);
    expect(toolchain.services).toEqual([]);
    expect(diagnostics.map((entry) => entry.code)).toEqual(["TOOLCHAIN_INVALID"]);
    expect(diagnostics[0]?.file).toBe(".devsecops/toolchain.yaml");
  });
});
