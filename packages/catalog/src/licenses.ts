/** Kept apart from the schema so the UI can import it without bundling zod or the catalogue. */
export const OPEN_SOURCE_LICENSES = [
  "AGPL-3.0-only",
  "Apache-2.0",
  "BSD-3-Clause",
  "GPL-2.0-only",
  "GPL-3.0-only",
  "LGPL-2.1-only",
  "LGPL-3.0-only",
  "MIT",
  "MPL-2.0",
] as const;

export const OTHER_LICENSES = ["BUSL-1.1", "FSL-1.1-Apache-2.0", "Proprietary"] as const;

export function isOpenSource(tool: { license: string }): boolean {
  return (OPEN_SOURCE_LICENSES as readonly string[]).includes(tool.license);
}
