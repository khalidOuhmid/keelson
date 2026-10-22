import type { OpaqueBlock } from "@keelson/core";

export function sliceOpaque(text: string, block: OpaqueBlock): string {
  const { start, end } = block.range;
  if (start < 0 || end > text.length || start >= end) {
    return "";
  }
  return text.slice(start, end).replace(/\r?\n$/, "");
}
