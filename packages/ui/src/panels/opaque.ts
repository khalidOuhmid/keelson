import type { OpaqueBlock } from "@keelson/core";

/** `null` when the range cannot be read — out of bounds, inverted or empty. An opaque block
 *  promises verbatim bytes: returning `""` would confuse it with a truly empty block, and the only
 *  surface whose guarantee is "this is intact" could not say that it does not know. */
export function sliceOpaque(text: string, block: OpaqueBlock): string | null {
  const { start, end } = block.range;
  if (start < 0 || end > text.length || start >= end) {
    return null;
  }
  return text.slice(start, end).replace(/\r?\n$/, "");
}
