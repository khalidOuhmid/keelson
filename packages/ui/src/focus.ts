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
    found.focus();
  } else if (frames > 0) {
    requestAnimationFrame(() => focusWhenDrawn(selector, frames - 1));
  }
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
