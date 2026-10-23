import type { Document, LineCounter } from "yaml";
import type { IncludeReader } from "./includes.ts";

/** `file` et `read` sont ce qu'il faut pour **reparser le même pipeline** : `apply` relit le texte
 *  pour obtenir l'IR d'avant et d'après, et sans eux il le relirait sans ses `include`. Le garde de
 *  cycle et le refus d'éditer un fichier inclus porteraient alors sur un pipeline amputé. */
export type GitlabDocument = {
  text: string;
  hash: string;
  yaml: Document.Parsed;
  lineCounter: LineCounter;
  file: string;
  read: IncludeReader | null;
};
