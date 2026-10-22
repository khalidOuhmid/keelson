import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ApiFailure } from "../../src/api/client.ts";
import { ErrorBanner } from "../../src/editing/ErrorBanner.tsx";
import { HistoryControls } from "../../src/editing/HistoryControls.tsx";
import { useHistoryShortcuts } from "../../src/editing/useHistoryShortcuts.ts";

afterEach(cleanup);

type Calls = { undo: number; redo: number };

function Harness({ calls, enabled = true }: { calls: Calls; enabled?: boolean }) {
  useHistoryShortcuts({
    enabled,
    onUndo: () => {
      calls.undo += 1;
    },
    onRedo: () => {
      calls.redo += 1;
    },
  });
  return (
    <div>
      <input aria-label="champ" />
      <textarea aria-label="zone" />
    </div>
  );
}

function harness(enabled = true): Calls {
  const calls: Calls = { undo: 0, redo: 0 };
  render(<Harness calls={calls} enabled={enabled} />);
  return calls;
}

describe("useHistoryShortcuts", () => {
  test("Ctrl+Z annule", async () => {
    const calls = harness();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(calls).toEqual({ undo: 1, redo: 0 });
  });

  test("Cmd+Z annule aussi", async () => {
    const calls = harness();
    await userEvent.keyboard("{Meta>}z{/Meta}");
    expect(calls).toEqual({ undo: 1, redo: 0 });
  });

  test("Ctrl+Shift+Z rétablit", async () => {
    const calls = harness();
    await userEvent.keyboard("{Control>}{Shift>}Z{/Shift}{/Control}");
    expect(calls).toEqual({ undo: 0, redo: 1 });
  });

  test("Cmd+Shift+Z rétablit aussi", async () => {
    const calls = harness();
    await userEvent.keyboard("{Meta>}{Shift>}Z{/Shift}{/Meta}");
    expect(calls).toEqual({ undo: 0, redo: 1 });
  });

  test("z sans modificateur ne fait rien", async () => {
    const calls = harness();
    await userEvent.keyboard("z");
    expect(calls).toEqual({ undo: 0, redo: 0 });
  });

  test("le raccourci est ignoré dans un champ de saisie", async () => {
    const calls = harness();
    screen.getByLabelText("champ").focus();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(calls).toEqual({ undo: 0, redo: 0 });
  });

  test("le raccourci est ignoré dans une zone de texte", async () => {
    const calls = harness();
    screen.getByLabelText("zone").focus();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(calls).toEqual({ undo: 0, redo: 0 });
  });

  test("les raccourcis sont inertes quand l'édition est désactivée", async () => {
    const calls = harness(false);
    await userEvent.keyboard("{Control>}z{/Control}");
    await userEvent.keyboard("{Control>}{Shift>}Z{/Shift}{/Control}");
    expect(calls).toEqual({ undo: 0, redo: 0 });
  });

  test("le gestionnaire est retiré au démontage", async () => {
    const calls: Calls = { undo: 0, redo: 0 };
    const view = render(<Harness calls={calls} />);
    view.unmount();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(calls).toEqual({ undo: 0, redo: 0 });
  });
});

describe("HistoryControls", () => {
  function controls(options: { canUndo?: boolean; canRedo?: boolean } = {}) {
    const calls: Calls = { undo: 0, redo: 0 };
    render(
      <HistoryControls
        canUndo={options.canUndo ?? true}
        canRedo={options.canRedo ?? true}
        onUndo={() => {
          calls.undo += 1;
        }}
        onRedo={() => {
          calls.redo += 1;
        }}
      />,
    );
    return calls;
  }

  test("le bouton Undo annule", async () => {
    const calls = controls();
    await userEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(calls.undo).toBe(1);
  });

  test("le bouton Redo rétablit", async () => {
    const calls = controls();
    await userEvent.click(screen.getByRole("button", { name: /redo/i }));
    expect(calls.redo).toBe(1);
  });

  test("les boutons sont désactivés quand les piles sont vides", () => {
    controls({ canUndo: false, canRedo: false });
    expect(screen.getByRole("button", { name: /undo/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /redo/i }).hasAttribute("disabled")).toBe(true);
  });

  test("un bouton désactivé n'appelle rien", async () => {
    const calls = controls({ canUndo: false });
    await userEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(calls.undo).toBe(0);
  });

  test("le raccourci est annoncé dans le nom accessible", () => {
    controls();
    expect(screen.getByRole("button", { name: /undo/i }).getAttribute("title")).toMatch(/Z/);
  });
});

describe("ErrorBanner", () => {
  function failure(overrides: Partial<ApiFailure> = {}): ApiFailure {
    return { status: 422, code: "STAGE_EXISTS", message: "le stage existe déjà", ...overrides };
  }

  test("n'affiche rien sans erreur", () => {
    const { container } = render(<ErrorBanner error={null} onDismiss={() => {}} />);
    expect(container.textContent).toBe("");
  });

  test("affiche le message du serveur tel quel", () => {
    render(<ErrorBanner error={failure()} onDismiss={() => {}} />);
    expect(screen.getByText("le stage existe déjà")).toBeDefined();
  });

  test("affiche le code du serveur", () => {
    render(<ErrorBanner error={failure()} onDismiss={() => {}} />);
    expect(screen.getByText("STAGE_EXISTS")).toBeDefined();
  });

  test("est une alerte pour un lecteur d'écran", () => {
    render(<ErrorBanner error={failure()} onDismiss={() => {}} />);
    expect(screen.getByRole("alert")).toBeDefined();
  });

  test("sur JOB_REFERENCED, liste les jobs qui référencent la cible", () => {
    render(
      <ErrorBanner
        error={failure({
          code: "JOB_REFERENCED",
          message: "référencé",
          details: { referencedBy: ["unit", "ship"] },
        })}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText("unit")).toBeDefined();
    expect(screen.getByText("ship")).toBeDefined();
  });

  test("n'invente pas de liste quand JOB_REFERENCED n'a pas de details", () => {
    render(<ErrorBanner error={failure({ code: "JOB_REFERENCED" })} onDismiss={() => {}} />);
    expect(screen.queryByRole("list")).toBeNull();
  });

  test("ne traite aucun autre code de façon particulière", () => {
    render(
      <ErrorBanner
        error={failure({ code: "CYCLE", details: { referencedBy: ["unit"] } })}
        onDismiss={() => {}}
      />,
    );
    expect(screen.queryByRole("list")).toBeNull();
  });

  test("l'erreur est refermable au clavier", async () => {
    let dismissed = 0;
    render(
      <ErrorBanner
        error={failure()}
        onDismiss={() => {
          dismissed += 1;
        }}
      />,
    );
    screen.getByRole("button", { name: /dismiss/i }).focus();
    await userEvent.keyboard("{Enter}");
    expect(dismissed).toBe(1);
  });
});
