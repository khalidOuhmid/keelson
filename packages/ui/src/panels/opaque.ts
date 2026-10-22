import type { OpaqueBlock } from "@keelson/core";

/** `null` quand la plage ne peut pas être lue — hors bornes, inversée ou vide. Un bloc opaque
 *  promet des octets verbatim : rendre `""` le confondrait avec un bloc réellement vide, et la
 *  seule surface dont la garantie est « ceci est intact » ne saurait pas dire qu'elle ne sait pas. */
export function sliceOpaque(text: string, block: OpaqueBlock): string | null {
  const { start, end } = block.range;
  if (start < 0 || end > text.length || start >= end) {
    return null;
  }
  return text.slice(start, end).replace(/\r?\n$/, "");
}
