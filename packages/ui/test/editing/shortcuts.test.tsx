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
      <div className="cm-editor">
        <div className="cm-content" contentEditable={false} data-testid="cm-content" />
      </div>
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
  /** Les surcharges ne sont pas typées : deux tests ci-dessous envoient volontairement des `params`
   *  que le type interdit — un `JOB_REFERENCED` sans `referencedBy`, un `CYCLE` qui en porte un.
   *  C'est exactement ce qu'un serveur d'une autre version peut mettre sur le fil, et le point de
   *  ces tests est que l'UI n'en invente rien. */
  function failure(overrides: Record<string, unknown> = {}): ApiFailure {
    return {
      status: 422,
      code: "STAGE_EXISTS",
      params: { stage: "build" },
      ...overrides,
    } as ApiFailure;
  }

  test("n'affiche rien sans erreur", () => {
    const { container } = render(<ErrorBanner error={null} onDismiss={() => {}} />);
    expect(container.textContent).toBe("");
  });

  test("affiche la phrase anglaise rendue depuis le code et les params", () => {
    render(<ErrorBanner error={failure()} onDismiss={() => {}} />);
    expect(screen.getByText('stage "build" already exists')).toBeDefined();
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
          params: { job: "compile", referencedBy: ["unit", "ship"] },
        })}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText("unit")).toBeDefined();
    expect(screen.getByText("ship")).toBeDefined();
  });

  test("n'invente pas de liste quand JOB_REFERENCED n'a pas de referencedBy", () => {
    render(
      <ErrorBanner
        error={failure({ code: "JOB_REFERENCED", params: { job: "compile" } })}
        onDismiss={() => {}}
      />,
    );
    expect(screen.queryByRole("list")).toBeNull();
  });

  test("ne traite aucun autre code de façon particulière", () => {
    render(
      <ErrorBanner
        error={failure({ code: "CYCLE", params: { operation: "addNeed", referencedBy: ["unit"] } })}
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

describe("useHistoryShortcuts — le visualiseur de bloc opaque", () => {
  /** Trouvé par /impeccable critique le 2026-10-22 : le garde ne reconnaissait que INPUT,
   *  TEXTAREA et `isContentEditable`. Le `.cm-content` de CodeMirror en lecture seule est un `div`
   *  en `contenteditable="false"`, donc `isContentEditable` y vaut `false` : Ctrl+Z dans le
   *  visualiseur déclenchait une opération serveur au lieu de ne rien faire. */
  test("Ctrl+Z dans un éditeur CodeMirror ne déclenche pas d'annulation", async () => {
    const calls = harness();
    screen.getByTestId("cm-content").focus();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(calls).toEqual({ undo: 0, redo: 0 });
  });

  test("Ctrl+Z hors de l'éditeur annule toujours", async () => {
    const calls = harness();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(calls.undo).toBe(1);
  });
});
