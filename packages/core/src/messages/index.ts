import type { MessageCode, ParamsOf } from "./codes.ts";
import { EN } from "./en.ts";

export * from "./codes.ts";
export type { Catalogue, Renderer } from "./en.ts";
export { EN } from "./en.ts";

type Branches = Record<string, (params: unknown) => string>;

/** Un code et ses `params`, appariés. Diagnostics et erreurs d'opération en sont des
 *  spécialisations, et sont donc directement rendables par `renderMessage` : sans cette forme, un
 *  appelant qui tient un diagnostic devrait passer `code` et `params` séparément, et le compilateur
 *  ne saurait plus qu'ils vont ensemble. */
export type Message = { [C in MessageCode]: { code: C; params: ParamsOf<C> } }[MessageCode];

export function renderMessage(message: Message): string {
  return render(message.code, message.params);
}

/** Le seul endroit du produit où un `(code, params)` devient du texte. La CLI et l'UI passent
 *  toutes deux par ici : une seule formulation par code, pour tout le produit.
 *
 *  **Ne lève jamais.** Les `params` de l'UI viennent du réseau : le type promet leur forme, le fil
 *  ne la garantit pas. Un rendu qui lève le ferait pendant l'affichage d'une *autre* erreur, donc
 *  au pire moment — l'écran deviendrait blanc au lieu d'afficher le refus du serveur. Le repli est
 *  le texte d'`UNEXPECTED_RESPONSE` ; le code d'origine, lui, reste affiché à côté par l'appelant,
 *  donc l'information n'est pas perdue. */
export function render<C extends MessageCode>(code: C, params: ParamsOf<C>): string {
  const renderer = EN[code] as ((params: ParamsOf<C>) => string) | Branches;
  try {
    if (typeof renderer === "function") {
      return renderer(params);
    }
    const reason = (params as { reason: string }).reason;
    const branch = renderer[reason];
    return branch === undefined ? EN.UNEXPECTED_RESPONSE({}) : branch(params);
  } catch {
    return EN.UNEXPECTED_RESPONSE({});
  }
}
