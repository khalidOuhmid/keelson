import { type KeyboardEvent as ReactKeyboardEvent, type RefObject, useEffect, useRef } from "react";

/** The focus policy, in one place.
 *
 *  - A surface that covers the rest of the screen owns focus: the confirmation dialog, the job
 *    search, and below `lg` the full-screen overlays. Tab and Shift+Tab cycle inside it.
 *  - Opening a surface moves focus into it; closing it, by its button or by Escape, returns focus
 *    to the control that opened it, or to the nearest stable place when that control is gone.
 *  - Only a surface that blocks the page is announced with `aria-modal`. */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.closest("[hidden], [inert]") === null,
  );
}

/** Keeps Tab inside `container`. Returns `true` when it handled the key. */
export function trapTab(
  container: HTMLElement,
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">,
): boolean {
  if (event.key !== "Tab") {
    return false;
  }
  const items = focusables(container);
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) {
    event.preventDefault();
    return true;
  }
  const active = document.activeElement as HTMLElement | null;
  const index = active === null ? -1 : items.indexOf(active);
  const next = event.shiftKey
    ? index <= 0
      ? last
      : items[index - 1]
    : index === -1 || index === items.length - 1
      ? first
      : items[index + 1];
  event.preventDefault();
  next?.focus();
  return true;
}

/** Below `lg`, the side panels become full-screen overlays (ADR 0008). */
export function overlaysCover(): boolean {
  return typeof window.matchMedia === "function"
    ? !window.matchMedia("(min-width: 64rem)").matches
    : false;
}

/** Graph layout and lazily mounted panels are asynchronous: the target may not exist on the next
 *  render. */
export function focusWhenDrawn(selector: string, frames = 120): void {
  const found = document.querySelector<HTMLElement>(selector);
  if (found !== null) {
    // A graph node is revealed by panning the graph: a browser scroll of its container would move
    // the nodes out from under the viewport, and the node off the canvas.
    found.focus(found.closest(".react-flow") === null ? undefined : { preventScroll: true });
  } else if (frames > 0) {
    requestAnimationFrame(() => focusWhenDrawn(selector, frames - 1));
  }
}

const CONTROLS = "a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]";

function signature(element: Element): string {
  const label = element.closest("label")?.textContent ?? "";
  const name = element.getAttribute("aria-label") ?? (label === "" ? element.textContent : label);
  return `${element.tagName}:${(name ?? "").trim()}`;
}

/** A write disables the form, or remounts it with the written values: either way the browser
 *  drops focus on `<body>`. Once the write settles, the control that submitted it, found again by
 *  its name, gets focus back — unless the user has moved focus elsewhere in the meantime. */
export async function keepFocusThrough(
  container: HTMLElement | null,
  run: () => Promise<unknown>,
  frames = 120,
): Promise<void> {
  const active = document.activeElement as HTMLElement | null;
  if (container === null || active === null || !container.contains(active)) {
    await run();
    return;
  }
  const wanted = signature(active);
  const index = [...container.querySelectorAll(CONTROLS)].indexOf(active);
  await run();
  const restore = (left: number): void => {
    const current = document.activeElement;
    const lost =
      current === null ||
      current === document.body ||
      (current === active && (!active.isConnected || active.hasAttribute("disabled")));
    if (!lost) {
      return;
    }
    const controls = [...container.querySelectorAll<HTMLElement>(CONTROLS)];
    const target =
      controls.find((control) => signature(control) === wanted) ??
      controls[Math.min(index, controls.length - 1)];
    if (target?.isConnected && !target.hasAttribute("disabled")) {
      target.focus();
    } else if (left > 0) {
      requestAnimationFrame(() => restore(left - 1));
    }
  };
  restore(frames);
}

/** A side panel that, below `lg`, covers the screen: on open, focus enters it; while it covers,
 *  Tab cycles inside it. From `lg` up it is a column like any other and leaves focus alone. */
export function useCoveringPanel<T extends HTMLElement>(
  open: boolean,
): {
  ref: RefObject<T | null>;
  onKeyDown: (event: ReactKeyboardEvent<T>) => void;
} {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const panel = ref.current;
    if (open && panel !== null && overlaysCover() && !panel.contains(document.activeElement)) {
      focusables(panel)[0]?.focus();
    }
  }, [open]);
  return {
    ref,
    onKeyDown: (event) => {
      if (overlaysCover()) {
        trapTab(event.currentTarget, event);
      }
    },
  };
}
