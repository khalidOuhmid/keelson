import { describe, expect, test } from "bun:test";
import { parseCommandArgs } from "../src/args.ts";

const formatSpec = {
  options: { format: { type: "string" } },
  allowPositionals: true,
} as const;

const flagSpec = {
  options: { "no-open": { type: "boolean" }, port: { type: "string" } },
  allowPositionals: true,
} as const;

describe("options avec valeur", () => {
  test("lit une option et sa valeur", () => {
    const result = parseCommandArgs(["--format", "json"], formatSpec);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.format).toBe("json");
      expect(result.positionals).toEqual([]);
    }
  });

  test("accepte la forme --option=valeur", () => {
    const result = parseCommandArgs(["--format=json"], formatSpec);
    expect(result.ok && result.values.format).toBe("json");
  });

  test("refuse une option à valeur sans valeur", () => {
    const result = parseCommandArgs(["--format"], formatSpec);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("--format");
    }
  });

  test("laisse l'option absente à undefined", () => {
    const result = parseCommandArgs([], formatSpec);
    expect(result.ok && result.values.format).toBeUndefined();
  });
});

describe("positionnels", () => {
  test("collecte les positionnels dans l'ordre", () => {
    const result = parseCommandArgs(["un", "deux"], formatSpec);
    expect(result.ok && result.positionals).toEqual(["un", "deux"]);
  });

  test("sépare positionnels et options", () => {
    const result = parseCommandArgs(["fichier.yml", "--format", "json"], formatSpec);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.positionals).toEqual(["fichier.yml"]);
      expect(result.values.format).toBe("json");
    }
  });

  test("refuse un positionnel quand ils ne sont pas autorisés", () => {
    const result = parseCommandArgs(["trop"], {
      options: {},
      allowPositionals: false,
    });
    expect(result.ok).toBe(false);
  });
});

describe("options booléennes", () => {
  test("une option booléenne présente vaut true", () => {
    const result = parseCommandArgs(["--no-open"], flagSpec);
    expect(result.ok && result.values["no-open"]).toBe(true);
  });

  test("une option booléenne absente vaut undefined", () => {
    const result = parseCommandArgs([], flagSpec);
    expect(result.ok && result.values["no-open"]).toBeUndefined();
  });
});

describe("options inconnues", () => {
  test("refuse une option inconnue en la nommant", () => {
    const result = parseCommandArgs(["--strict"], formatSpec);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("--strict");
    }
  });

  test("refuse une option courte inconnue", () => {
    const result = parseCommandArgs(["-x"], formatSpec);
    expect(result.ok).toBe(false);
  });
});

describe("robustesse", () => {
  test("ne lève jamais, même sur une entrée absurde", () => {
    for (const argv of [["--"], ["---"], ["--format", "--format"], ["-"], [""]]) {
      expect(() => parseCommandArgs(argv, formatSpec)).not.toThrow();
    }
  });

  test("le message d'erreur est toujours une chaîne non vide", () => {
    const result = parseCommandArgs(["--inconnu"], formatSpec);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});
