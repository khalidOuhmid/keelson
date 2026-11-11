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
  test("Ctrl+Z undoes", async () => {
    const calls = harness();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(calls).toEqual({ undo: 1, redo: 0 });
  });

  test("Cmd+Z undoes too", async () => {
    const calls = harness();
    await userEvent.keyboard("{Meta>}z{/Meta}");
    expect(calls).toEqual({ undo: 1, redo: 0 });
  });

  test("Ctrl+Shift+Z redoes", async () => {
    const calls = harness();
    await userEvent.keyboard("{Control>}{Shift>}Z{/Shift}{/Control}");
    expect(calls).toEqual({ undo: 0, redo: 1 });
  });

  test("Cmd+Shift+Z redoes too", async () => {
    const calls = harness();
    await userEvent.keyboard("{Meta>}{Shift>}Z{/Shift}{/Meta}");
    expect(calls).toEqual({ undo: 0, redo: 1 });
  });

  test("z without a modifier does nothing", async () => {
    const calls = harness();
    await userEvent.keyboard("z");
    expect(calls).toEqual({ undo: 0, redo: 0 });
  });

  test("the shortcut is ignored in an input field", async () => {
    const calls = harness();
    screen.getByLabelText("champ").focus();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(calls).toEqual({ undo: 0, redo: 0 });
  });

  test("the shortcut is ignored in a textarea", async () => {
    const calls = harness();
    screen.getByLabelText("zone").focus();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(calls).toEqual({ undo: 0, redo: 0 });
  });

  test("shortcuts are inert when editing is disabled", async () => {
    const calls = harness(false);
    await userEvent.keyboard("{Control>}z{/Control}");
    await userEvent.keyboard("{Control>}{Shift>}Z{/Shift}{/Control}");
    expect(calls).toEqual({ undo: 0, redo: 0 });
  });

  test("the handler is removed on unmount", async () => {
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

  test("the Undo button undoes", async () => {
    const calls = controls();
    await userEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(calls.undo).toBe(1);
  });

  test("the Redo button redoes", async () => {
    const calls = controls();
    await userEvent.click(screen.getByRole("button", { name: /redo/i }));
    expect(calls.redo).toBe(1);
  });

  test("the buttons are disabled when the stacks are empty", () => {
    controls({ canUndo: false, canRedo: false });
    expect(screen.getByRole("button", { name: /undo/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /redo/i }).hasAttribute("disabled")).toBe(true);
  });

  test("a disabled button calls nothing", async () => {
    const calls = controls({ canUndo: false });
    await userEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(calls.undo).toBe(0);
  });

  test("the shortcut is announced in the accessible name", () => {
    controls();
    expect(screen.getByRole("button", { name: /undo/i }).getAttribute("title")).toMatch(/Z/);
  });
});

describe("ErrorBanner", () => {
  /** The overrides are untyped: two tests below deliberately send `params` the type forbids — a
   *  `JOB_REFERENCED` without `referencedBy`, a `CYCLE` that carries one. That is exactly what a
   *  server of another version can put on the wire, and the point of these tests is that the UI
   *  invents nothing from it. */
  function failure(overrides: Record<string, unknown> = {}): ApiFailure {
    return {
      status: 422,
      code: "STAGE_EXISTS",
      params: { stage: "build" },
      ...overrides,
    } as ApiFailure;
  }

  test("shows nothing without an error", () => {
    const { container } = render(<ErrorBanner error={null} onDismiss={() => {}} />);
    expect(container.textContent).toBe("");
  });

  test("shows the English sentence rendered from the code and params", () => {
    render(<ErrorBanner error={failure()} onDismiss={() => {}} />);
    expect(screen.getByText('stage "build" already exists')).toBeDefined();
  });

  test("shows the server code", () => {
    render(<ErrorBanner error={failure()} onDismiss={() => {}} />);
    expect(screen.getByText("STAGE_EXISTS")).toBeDefined();
  });

  test("is an alert for a screen reader", () => {
    render(<ErrorBanner error={failure()} onDismiss={() => {}} />);
    expect(screen.getByRole("alert")).toBeDefined();
  });

  test("on JOB_REFERENCED, renders the English sentence and every referrer", () => {
    const { container } = render(
      <ErrorBanner
        error={failure({
          code: "JOB_REFERENCED",
          params: { job: "compile", referencedBy: ["unit", "ship"] },
        })}
        onDismiss={() => {}}
      />,
    );
    // The sentence comes from `render()`, the chips from `params.referencedBy`: two separate paths
    // in the component, and the test fails if either breaks.
    expect(screen.getByText('job "compile" is needed by unit, ship')).toBeDefined();
    const referents = [...container.querySelectorAll("li")].map((node) => node.textContent);
    expect(referents).toEqual(["unit", "ship"]);
  });

  test("a code without params still renders its sentence", () => {
    render(
      <ErrorBanner
        error={failure({ status: 403, code: "FORBIDDEN_TOKEN", params: {} })}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText("the session token is missing or invalid")).toBeDefined();
    expect(screen.getByText("FORBIDDEN_TOKEN")).toBeDefined();
  });

  test("invents no list when JOB_REFERENCED has no referencedBy", () => {
    render(
      <ErrorBanner
        error={failure({ code: "JOB_REFERENCED", params: { job: "compile" } })}
        onDismiss={() => {}}
      />,
    );
    expect(screen.queryByRole("list")).toBeNull();
  });

  test("treats no other code specially", () => {
    render(
      <ErrorBanner
        error={failure({ code: "CYCLE", params: { operation: "addNeed", referencedBy: ["unit"] } })}
        onDismiss={() => {}}
      />,
    );
    expect(screen.queryByRole("list")).toBeNull();
  });

  test("the error can be dismissed from the keyboard", async () => {
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

describe("useHistoryShortcuts — the opaque block viewer", () => {
  /** Found by /impeccable critique on 2026-10-22: the guard only recognised INPUT, TEXTAREA and
   *  `isContentEditable`. CodeMirror's read-only `.cm-content` is a `div` with
   *  `contenteditable="false"`, so `isContentEditable` is `false` there: Ctrl+Z in the viewer
   *  triggered a server operation instead of doing nothing. */
  test("Ctrl+Z in a CodeMirror editor does not trigger undo", async () => {
    const calls = harness();
    screen.getByTestId("cm-content").focus();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(calls).toEqual({ undo: 0, redo: 0 });
  });

  test("Ctrl+Z outside the editor still undoes", async () => {
    const calls = harness();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(calls.undo).toBe(1);
  });
});
