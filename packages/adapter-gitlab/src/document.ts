import type { Document, LineCounter } from "yaml";
import type { IncludeReader } from "./includes.ts";

/** `file` and `read` are what it takes to **reparse the same pipeline**: `apply` re-reads the text
 *  to get the IR before and after, and without them it would re-read it without its `include`s.
 *  The cycle guard and the refusal to edit an included file would then apply to a truncated pipeline. */
export type GitlabDocument = {
  text: string;
  hash: string;
  yaml: Document.Parsed;
  lineCounter: LineCounter;
  file: string;
  read: IncludeReader | null;
};
