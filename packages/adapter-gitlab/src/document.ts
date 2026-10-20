import type { Document, LineCounter } from "yaml";

export type GitlabDocument = {
  text: string;
  hash: string;
  yaml: Document.Parsed;
  lineCounter: LineCounter;
};
