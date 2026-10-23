export const PACKAGE_NAME = "@keelson/core";

export * from "./diagnostics.ts";
export * from "./hash.ts";
export * from "./ir.ts";
/** Le rendu du texte n'est **pas** réexporté ici : il vit derrière `@keelson/core/messages`, pour
 *  que l'import dise quelle couche on touche. Seules les formes de `params` le sont, parce que les
 *  signatures de `Diagnostic` et d'`OperationError` en dépendent. */
export type { MessageCode, MessageParams, ParamsOf } from "./messages/codes.ts";
export * from "./operations.ts";
export * from "./result.ts";
export * from "./validate.ts";
