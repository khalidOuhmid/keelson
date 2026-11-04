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

describe("lecture de toolchain.yaml", () => {
  test("un fichier absent ou vide est une toolchain vide, sans diagnostic", () => {
    for (const text of [null, "", "# rien\n"]) {
      expect(parseToolchain(text)).toEqual({
        toolchain: { services: [], integrations: [], dismissed: [] },
        diagnostics: [],
      });
    }
  });

  test("les trois sections, dans l'ordre du fichier", () => {
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

  test("une section vide vaut une section absente", () => {
    expect(parseToolchain("version: 1\nservices:\nintegrations: []\n").diagnostics).toEqual([]);
  });

  test.each([
    ["YAML cassé", "version: 1\nservices: [\n"],
    ["alias sans ancre", "*x\n"],
    ["clé dupliquée", "version: 1\nversion: 1\n"],
    ["version absente", "services: {}\n"],
    ["version inconnue", "version: 2\n"],
    ["racine scalaire", "bonjour\n"],
    ["identifiant illégal", "version: 1\nservices:\n  __proto__:\n    tool: x\n"],
    [
      "type d'intégration inconnu",
      "version: 1\nintegrations:\n  - {job: a, service: b, kind: x}\n",
    ],
    ["clé inconnue", "version: 1\nvoici: 1\n"],
  ])("%s rend TOOLCHAIN_INVALID et une toolchain vide", (_label, text) => {
    const { toolchain, diagnostics } = parseToolchain(text);
    expect(toolchain.services).toEqual([]);
    expect(diagnostics.map((entry) => entry.code)).toEqual(["TOOLCHAIN_INVALID"]);
    expect(diagnostics[0]?.file).toBe(".devsecops/toolchain.yaml");
  });
});
