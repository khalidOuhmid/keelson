import { describe, expect, test } from "bun:test";
import { hashText, type ToolchainOperation } from "@keelson/core";
import { applyToolchain, parseToolchain } from "../src/index.ts";

const BASE = `# plateforme
version: 1

services:
  # le dépôt d'images
  nexus:
    tool: nexus # interne
    url: https://nexus.example.org

  vault:
    tool: vault

integrations:
  - job: build
    service: nexus
    kind: push

# fin
`;

type Draft = ToolchainOperation extends infer O
  ? O extends ToolchainOperation
    ? Omit<O, "v" | "baseHash">
    : never
  : never;

function run(text: string, draft: Draft) {
  return applyToolchain(text, { v: 1, baseHash: hashText(text), ...draft } as ToolchainOperation);
}

function edited(text: string, draft: Draft): string {
  const result = run(text, draft);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value.text;
}

function code(text: string, draft: Draft): string | null {
  const result = run(text, draft);
  return result.ok ? null : result.error.code;
}

const add = { kind: "addService", tool: "harbor", url: null, environment: null } as const;

describe("services", () => {
  test("ajouter crée le fichier depuis rien", () => {
    expect(edited("", { ...add, id: "harbor" })).toBe(
      "version: 1\nservices:\n  harbor:\n    tool: harbor\n",
    );
  });

  test("ajouter garde tout le reste, en fin de section, à l'indentation trouvée", () => {
    const text = edited(BASE, { ...add, id: "harbor", url: "https://h", environment: "prod" });
    expect(text).toContain(
      "  vault:\n    tool: vault\n  harbor:\n    tool: harbor\n    url: https://h\n    environment: prod\n",
    );
    expect(text).toContain("# le dépôt d'images");
    expect(text).toContain("# fin");
  });

  test("ajouter sous une section vide ou [] / {}", () => {
    for (const empty of ["services:\n", "services: {}\n"]) {
      expect(edited(`version: 1\n${empty}`, { ...add, id: "h" })).toBe(
        "version: 1\nservices:\n  h:\n    tool: harbor\n",
      );
    }
  });

  test("ajouter à un fichier sans fin de ligne, et en CRLF", () => {
    expect(edited("version: 1", { ...add, id: "h" })).toBe(
      "version: 1\nservices:\n  h:\n    tool: harbor\n",
    );
    expect(edited("version: 1\r\n", { ...add, id: "h" })).toBe(
      "version: 1\r\nservices:\r\n  h:\r\n    tool: harbor\r\n",
    );
  });

  test("une URL piégée reste une chaîne", () => {
    const text = edited("", { ...add, id: "h", url: "a: b #c\nd" });
    expect(parseToolchain(text).toolchain.services[0]?.url).toBe("a: b #c\nd");
  });

  test("un identifiant déjà pris ou illégal est refusé", () => {
    expect(code(BASE, { ...add, id: "nexus" })).toBe("NAME_CONFLICT");
    expect(code(BASE, { ...add, id: "Bad Name" })).toBe("INVALID_NAME");
  });

  test("modifier remplace la valeur et garde le commentaire", () => {
    const text = edited(BASE, { kind: "updateService", id: "nexus", tool: "harbor" });
    expect(text).toContain("    tool: harbor # interne\n");
  });

  test("modifier ajoute un champ absent, et null le retire", () => {
    const text = edited(BASE, {
      kind: "updateService",
      id: "nexus",
      url: null,
      environment: "staging",
    });
    expect(text).toContain("    tool: nexus # interne\n    environment: staging\n");
    expect(text).not.toContain("url:");
  });

  test("modifier un champ sans valeur", () => {
    const text = "version: 1\nservices:\n  a:\n    tool: x\n    url:\n";
    expect(edited(text, { kind: "updateService", id: "a", url: "u" })).toBe(
      "version: 1\nservices:\n  a:\n    tool: x\n    url: u\n",
    );
  });

  test("ne rien changer ne touche rien", () => {
    const result = run(BASE, { kind: "updateService", id: "vault" });
    expect(result.ok && result.value.text).toBe(BASE);
    expect(result.ok && result.value.touched).toEqual([]);
  });

  test("retirer enlève le bloc, pas les commentaires des voisins", () => {
    const text = edited(BASE.replace("    service: nexus\n", "    service: vault\n"), {
      kind: "removeService",
      id: "nexus",
    });
    expect(text).toContain("# le dépôt d'images\n\n  vault:");
    expect(text).not.toContain("nexus");
  });

  test("retirer un service relié est refusé, en nommant les jobs", () => {
    const result = run(BASE, { kind: "removeService", id: "nexus" });
    expect(result.ok ? null : result.error).toEqual({
      code: "SERVICE_REFERENCED",
      params: { service: "nexus", jobs: ["build"] },
    });
  });

  test("un service inconnu est refusé", () => {
    expect(code(BASE, { kind: "removeService", id: "x" })).toBe("SERVICE_NOT_FOUND");
    expect(code(BASE, { kind: "updateService", id: "x" })).toBe("SERVICE_NOT_FOUND");
  });
});

describe("intégrations", () => {
  const link = {
    kind: "addIntegration",
    job: "b",
    service: "vault",
    integration: "notify",
  } as const;

  test("ajouter en fin de liste", () => {
    expect(edited(BASE, link)).toContain(
      "    kind: push\n  - job: b\n    service: vault\n    kind: notify\n",
    );
  });

  test("ajouter crée la section absente", () => {
    const text = "version: 1\nservices:\n  vault:\n    tool: vault\n";
    expect(edited(text, link)).toBe(
      `${text}integrations:\n  - job: b\n    service: vault\n    kind: notify\n`,
    );
  });

  test("garde l'indentation d'une liste à la colonne zéro", () => {
    const text =
      "version: 1\nservices:\n  vault:\n    tool: vault\nintegrations:\n- job: a\n  service: vault\n  kind: push\n";
    expect(edited(text, link)).toBe(`${text}- job: b\n  service: vault\n  kind: notify\n`);
  });

  test("un job au nom piégé reste lisible", () => {
    const text = edited(BASE, { ...link, job: "deploy: prod" });
    expect(parseToolchain(text).toolchain.integrations.at(-1)?.job).toBe("deploy: prod");
  });

  test("refuse un service inconnu et un doublon", () => {
    expect(code(BASE, { ...link, service: "x" })).toBe("SERVICE_NOT_FOUND");
    expect(
      code(BASE, { kind: "addIntegration", job: "build", service: "nexus", integration: "push" }),
    ).toBe("INTEGRATION_EXISTS");
  });

  test("retirer enlève l'élément", () => {
    const text = edited(BASE, {
      kind: "removeIntegration",
      job: "build",
      service: "nexus",
      integration: "push",
    });
    expect(parseToolchain(text).toolchain.integrations).toEqual([]);
    expect(text).toContain("# fin");
  });

  test("retirer un élément absent est refusé", () => {
    expect(code(BASE, { ...link, kind: "removeIntegration" })).toBe("INTEGRATION_NOT_FOUND");
  });

  test("écarter puis rétablir une inférence", () => {
    const dismiss = {
      kind: "dismissIntegration",
      job: "b",
      tool: "sentry",
      integration: "notify",
    } as const;
    const text = edited(BASE, dismiss);
    expect(parseToolchain(text).toolchain.dismissed).toEqual([
      { job: "b", tool: "sentry", kind: "notify" },
    ]);
    expect(code(text, dismiss)).toBe("INTEGRATION_EXISTS");
    expect(edited(text, { ...dismiss, kind: "restoreIntegration" })).toContain("dismissed:");
    expect(
      parseToolchain(edited(text, { ...dismiss, kind: "restoreIntegration" })).toolchain.dismissed,
    ).toEqual([]);
  });
});

describe("refus", () => {
  test("un hash périmé", () => {
    const result = applyToolchain(BASE, {
      v: 1,
      baseHash: "a".repeat(64),
      kind: "removeService",
      id: "vault",
    });
    expect(result.ok ? null : result.error.code).toBe("STALE_DOCUMENT");
  });

  test("un fichier invalide n'est pas édité", () => {
    const result = run("version: 2\n", { ...add, id: "h" });
    expect(result.ok ? null : result.error).toEqual({
      code: "INVALID_OPERATION",
      params: { reason: "invalidToolchain" },
    });
  });

  test("une section en flow non vide n'est pas réécrite", () => {
    const result = run("version: 1\nservices: {a: {tool: x}}\n", { ...add, id: "h" });
    expect(result.ok ? null : result.error).toEqual({
      code: "INVALID_OPERATION",
      params: { reason: "flowStyleToolchain", section: "services" },
    });
  });

  test("un service en flow n'est pas réécrit", () => {
    const text = "version: 1\nservices:\n  a: {tool: x}\n";
    expect(code(text, { kind: "updateService", id: "a", url: "u" })).toBe("INVALID_OPERATION");
  });

  test("une valeur en alias n'est pas réécrite", () => {
    const text = "version: 1\nservices:\n  a:\n    tool: &t x\n  b:\n    tool: *t\n";
    expect(code(text, { kind: "updateService", id: "b", tool: "y" })).toBe("INVALID_OPERATION");
  });
});

describe("fichiers écrits à la main", () => {
  const BLOCK =
    "version: 1\nservices:\n  a:\n    tool: nexus\n    url: |\n      https://a\n  b:\n    tool: harbor\nintegrations:\n  - job: x\n    service: b\n    kind: push\n";

  test("retirer un service à valeur en bloc garde son voisin", () => {
    const text = edited(BLOCK, { kind: "removeService", id: "a" });
    const { services, integrations } = parseToolchain(text).toolchain;
    expect(services.map((service) => service.id)).toEqual(["b"]);
    expect(integrations).toHaveLength(1);
  });

  test("retirer le dernier service à valeur en bloc garde la section suivante", () => {
    const text =
      "version: 1\nservices:\n  a:\n    tool: x\n    url: |\n      u\nintegrations:\n  - job: j\n    service: z\n    kind: push\n";
    expect(edited(text, { kind: "removeService", id: "a" })).toContain("integrations:");
  });

  test("un champ retiré après une valeur en bloc ne touche pas le voisin", () => {
    const text = edited(BLOCK, { kind: "updateService", id: "a", url: null });
    expect(parseToolchain(text).toolchain.services.map((service) => service.id)).toEqual([
      "a",
      "b",
    ]);
  });

  test("un champ ajouté après une valeur en bloc reste dans son service", () => {
    const text = edited(BLOCK, { kind: "updateService", id: "a", environment: "prod" });
    const [first, second] = parseToolchain(text).toolchain.services;
    expect(first?.environment).toBe("prod");
    expect(second?.environment).toBeNull();
  });

  test("remplacer une valeur en bloc garde le commentaire suivant", () => {
    const text =
      "version: 1\nservices:\n  a:\n    tool: x\n    url: |\n      u\n    # note\n    environment: e\n";
    expect(edited(text, { kind: "updateService", id: "a", url: "v" })).toContain("    # note\n");
  });

  test("un élément de liste à valeur en bloc garde le suivant", () => {
    const text = edited(
      BLOCK.replace("  - job: x\n", "  - job: |-\n      x\n").concat(
        "  - job: y\n    service: b\n    kind: push\n",
      ),
      {
        kind: "removeIntegration",
        job: "x",
        service: "b",
        integration: "push",
      },
    );
    expect(parseToolchain(text).toolchain.integrations.map((entry) => entry.job)).toEqual(["y"]);
  });

  test.each(["~", "null", "!!null", "&s"])("une section valant %s se remplace", (token) => {
    const text = edited(`version: 1\nservices: ${token}\n`, { ...add, id: "h" });
    expect(parseToolchain(text).toolchain.services).toEqual([
      { id: "h", tool: "harbor", url: null, environment: null },
    ]);
    expect(text).not.toContain(token);
  });

  test("un commentaire sur la ligne de la section y reste", () => {
    expect(edited("version: 1\nservices: # plateforme\n", { ...add, id: "h" })).toBe(
      "version: 1\nservices: # plateforme\n  h:\n    tool: harbor\n",
    );
  });

  test("un espace avant les deux-points n'empêche pas d'écrire", () => {
    const text = edited("version: 1\nservices :\n", { ...add, id: "h" });
    expect(parseToolchain(text).toolchain.services).toHaveLength(1);
  });

  test("toucher une valeur ancrée changerait ses alias : refusé", () => {
    const text = "version: 1\nservices:\n  a: &base\n    tool: x\n  b: *base\n";
    const result = run(text, { kind: "updateService", id: "a", environment: "e" });
    expect(result.ok ? null : result.error).toMatchObject({
      code: "INVALID_OPERATION",
      params: { reason: "sharedValue" },
    });
    const scalar =
      "version: 1\nservices:\n  a:\n    tool: x\n    url: &u y\n  b:\n    tool: z\n    url: *u\n";
    expect(run(scalar, { kind: "updateService", id: "a", url: "w" })).toMatchObject({
      error: { params: { reason: "sharedValue" } },
    });
  });

  test("ce que le patch changerait sans le vouloir est refusé à la relecture", () => {
    const text = "version: 1\nservices:\n  a:\n    tool: x\n    url: |+\n      u\n\n";
    const result = run(text, { kind: "updateService", id: "a", environment: "e" });
    expect(result.ok ? null : result.error).toMatchObject({
      params: { reason: "wouldBreakYaml", operation: "updateService" },
    });
  });

  test("retirer une ancre dont un alias dépend est refusé", () => {
    const text = "version: 1\nservices:\n  a: &base\n    tool: x\n  b: *base\n";
    expect(code(text, { kind: "removeService", id: "a" })).toBe("INVALID_OPERATION");
  });

  test("un service en alias n'est pas présenté comme du flow", () => {
    const text = "version: 1\nservices:\n  a: &base\n    tool: x\n  b: *base\n";
    const result = run(text, { kind: "updateService", id: "b", url: "u" });
    expect(result.ok ? null : result.error).toMatchObject({ params: { reason: "sharedValue" } });
  });

  test.each(["a\u00a0", "--- x", "...", "x ".repeat(60).trim(), "\ufeffx", "- a", "1", "true"])(
    "la valeur %j se relit à l'identique",
    (value) => {
      const text = edited("", { ...add, id: "h", url: value });
      expect(parseToolchain(text).toolchain.services[0]?.url).toBe(value);
    },
  );

  test("deux champs ajoutés sans fin de ligne finale ne laissent pas de ligne vide", () => {
    expect(
      edited("version: 1\nservices:\n  a:\n    tool: x", {
        kind: "updateService",
        id: "a",
        url: "u",
        environment: "e",
      }),
    ).toBe("version: 1\nservices:\n  a:\n    tool: x\n    url: u\n    environment: e\n");
  });
});

describe("splice et inverse", () => {
  test("une plage hors du texte est refusée", () => {
    expect(code("abc", { kind: "splice", start: 2, end: 9, text: "" })).toBe("RANGE_OUT_OF_BOUNDS");
  });

  test("l'inverse restaure les octets", () => {
    const first = run(BASE, { ...add, id: "harbor" });
    if (!first.ok) {
      throw new Error("refusé");
    }
    const back = applyToolchain(first.value.text, first.value.inverse);
    expect(back.ok && back.value.text).toBe(BASE);
  });

  test("touched borne le changement", () => {
    const result = run(BASE, { ...add, id: "harbor" });
    const range = result.ok ? result.value.touched[0] : undefined;
    expect(result.ok && result.value.text.slice(range?.start, range?.end)).toBe(
      "  harbor:\n    tool: harbor\n",
    );
  });
});
