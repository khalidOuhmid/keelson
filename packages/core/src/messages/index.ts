import type { MessageCode, ParamsOf } from "./codes.ts";
import { EN } from "./en.ts";

export * from "./codes.ts";
export type { Catalogue, Renderer } from "./en.ts";
export { EN } from "./en.ts";

type Branches = Record<string, (params: unknown) => string>;

/** Le seul endroit du produit où un `(code, params)` devient du texte. La CLI et l'UI passent
 *  toutes deux par ici : une seule formulation par code, pour tout le produit. */
export function render<C extends MessageCode>(code: C, params: ParamsOf<C>): string {
  const renderer = EN[code] as ((params: ParamsOf<C>) => string) | Branches;
  if (typeof renderer === "function") {
    return renderer(params);
  }
  // Le type garantit qu'un rendu par branches n'est atteint qu'avec des `params` porteurs d'un
  // `reason`, et que la branche existe. Le cast ne fait que redire ce que le type sait déjà.
  const reason = (params as { reason: string }).reason;
  return (renderer[reason] as (params: ParamsOf<C>) => string)(params);
}
