import { afterEach, describe, expect, test } from "bun:test";
import type { Diagnostic } from "@keelson/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiagnosticsPanel } from "../../src/panels/DiagnosticsPanel.tsx";

afterEach(cleanup);

function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    code: "UNKNOWN_NEED",
    severity: "error",
    message: "le job « unit » a besoin de « absent », qui n'existe pas",
    range: { start: 40, end: 90 },
    ...overrides,
  };
}

type Picked = { start: number; end: number } | null;

function renderPanel(diagnostics: Diagnostic[], onSelect: (range: Picked) => void = () => {}) {
  return render(<DiagnosticsPanel diagnostics={diagnostics} onSelectRange={onSelect} />);
}

describe("structure", () => {
  test("le panneau est une région nommée", () => {
    renderPanel([]);
    expect(screen.getByRole("region", { name: /diagnostics/i })).toBeDefined();
  });

  test("aucun diagnostic affiche un état vide explicite", () => {
    renderPanel([]);
    expect(screen.getByText(/no diagnostics/i)).toBeDefined();
  });

  test("un élément de liste par diagnostic", () => {
    renderPanel([diagnostic(), diagnostic({ code: "NEEDS_CYCLE" })]);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  test("le compte des diagnostics est annoncé", () => {
    renderPanel([diagnostic(), diagnostic({ code: "NEEDS_CYCLE" })]);
    expect(screen.getByRole("region", { name: /diagnostics/i }).textContent).toContain("2");
  });
});

describe("contenu d'un diagnostic", () => {
  test("le code et le message sont affichés", () => {
    renderPanel([diagnostic()]);
    expect(screen.getByText("UNKNOWN_NEED")).toBeDefined();
    expect(screen.getByText(/n'existe pas/)).toBeDefined();
  });

  test("la sévérité est affichée en texte, pas seulement par la couleur", () => {
    renderPanel([
      diagnostic({ severity: "error" }),
      diagnostic({ severity: "warning", code: "NEED_LATER_STAGE" }),
      diagnostic({ severity: "info", code: "INCLUDE_UNRESOLVED" }),
    ]);
    expect(screen.getByText("error")).toBeDefined();
    expect(screen.getByText("warning")).toBeDefined();
    expect(screen.getByText("info")).toBeDefined();
  });

  test("chaque sévérité porte un glyphe distinct", () => {
    renderPanel([
      diagnostic({ severity: "error" }),
      diagnostic({ severity: "warning", code: "A" }),
      diagnostic({ severity: "info", code: "B" }),
    ]);
    // Les marques sont des SVG : c'est leur tracé qui les distingue, plus leur texte.
    const glyphs = screen.getAllByTestId("severity-glyph").map((node) => node.innerHTML);
    expect(new Set(glyphs).size).toBe(3);
    expect(glyphs.every((glyph) => glyph.includes("<svg"))).toBe(true);
  });

  test("les diagnostics sont triés par sévérité, erreurs d'abord", () => {
    renderPanel([
      diagnostic({ severity: "info", code: "INFO" }),
      diagnostic({ severity: "error", code: "ERREUR" }),
      diagnostic({ severity: "warning", code: "AVERT" }),
    ]);
    const codes = screen.getAllByTestId("diagnostic-code").map((node) => node.textContent);
    expect(codes).toEqual(["ERREUR", "AVERT", "INFO"]);
  });
});

describe("sélection", () => {
  test("un clic sur un diagnostic remonte sa plage", async () => {
    const picked: Picked[] = [];
    renderPanel([diagnostic()], (range) => picked.push(range));
    await userEvent.click(screen.getByRole("button", { name: /UNKNOWN_NEED/ }));
    expect(picked).toEqual([{ start: 40, end: 90 }]);
  });

  test("Entrée au clavier remonte aussi la plage", async () => {
    const picked: Picked[] = [];
    renderPanel([diagnostic()], (range) => picked.push(range));
    screen.getByRole("button", { name: /UNKNOWN_NEED/ }).focus();
    await userEvent.keyboard("{Enter}");
    expect(picked).toEqual([{ start: 40, end: 90 }]);
  });

  test("un diagnostic sans plage n'est pas cliquable", () => {
    renderPanel([diagnostic({ range: null })]);
    expect(screen.queryByRole("button", { name: /UNKNOWN_NEED/ })).toBeNull();
  });

  test("un diagnostic sans plage reste affiché", () => {
    renderPanel([diagnostic({ range: null })]);
    expect(screen.getByText("UNKNOWN_NEED")).toBeDefined();
  });

  test("chaque diagnostic cliquable est atteignable au clavier", () => {
    renderPanel([diagnostic(), diagnostic({ code: "NEEDS_CYCLE" })]);
    for (const button of screen.getAllByRole("button")) {
      expect(button.getAttribute("tabindex")).not.toBe("-1");
    }
  });
});
