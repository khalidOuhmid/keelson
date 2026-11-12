const original = window.matchMedia;

/** Below `lg`, side panels become full-screen overlays (ADR 0008). */
export function narrowViewport(): void {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

export function restoreViewport(): void {
  window.matchMedia = original;
}
