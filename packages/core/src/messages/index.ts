import type { MessageCode, ParamsOf } from "./codes.ts";
import { EN } from "./en.ts";

export * from "./codes.ts";
export type { Catalogue, Renderer } from "./en.ts";
export { EN } from "./en.ts";

type Branches = Record<string, (params: unknown) => string>;

/** A code and its `params`, paired. Diagnostics and operation errors are specialisations of it,
 *  and are therefore directly renderable by `renderMessage`: without this shape, a caller holding a
 *  diagnostic would have to pass `code` and `params` separately, and the compiler would no longer
 *  know they belong together. */
export type Message = { [C in MessageCode]: { code: C; params: ParamsOf<C> } }[MessageCode];

export function renderMessage(message: Message): string {
  return render(message.code, message.params);
}

/** The only place in the product where a `(code, params)` becomes text. The CLI and the UI both
 *  go through here: one wording per code, for the whole product.
 *
 *  **Never throws, and always returns a sentence.** The UI's `params` come from the network: the
 *  type promises their shape, the wire does not guarantee it. A renderer that throws would do so
 *  while displaying *another* error, hence at the worst moment — the screen would go blank instead
 *  of showing the server's refusal. Not throwing is not enough, though: a renderer whose body is a
 *  bare read of `params`, like `INVALID_YAML`, returns `undefined` without throwing, which the CLI
 *  then passed to `.replace()`. The fallback therefore covers both cases, and equals the text of
 *  `UNEXPECTED_RESPONSE`; the original code is still shown alongside by the caller, so no
 *  information is lost. */
export function render<C extends MessageCode>(code: C, params: ParamsOf<C>): string {
  const renderer = EN[code] as ((params: ParamsOf<C>) => string) | Branches;
  const produced = ((): unknown => {
    try {
      if (typeof renderer === "function") {
        return renderer(params);
      }
      const branch = renderer[(params as { reason: string }).reason];
      return branch === undefined ? undefined : branch(params);
    } catch {
      return undefined;
    }
  })();

  return typeof produced === "string" && produced.trim() !== ""
    ? produced
    : EN.UNEXPECTED_RESPONSE({});
}
