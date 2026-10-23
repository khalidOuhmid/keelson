import type { Origin } from "@keelson/core";

/** `label` est la voix de Keelson, `source` une chaîne venue du fichier de l'utilisateur. Les deux
 *  sont séparées parce qu'elles ne se composent pas de la même façon : le label se met en petites
 *  capitales, la source jamais — une clé de template GitLab est sensible à la casse, et
 *  `.deploy-base` affiché `.DEPLOY-BASE` est une donnée réécrite à l'écran. */
export type OriginLabel = {
  label: string;
  source: string | null;
};

export function describeOrigin(origin: Origin): OriginLabel | null {
  switch (origin.kind) {
    case "local":
      return null;
    case "default":
      return { label: "default", source: null };
    case "extends":
      return { label: "inherited from", source: origin.template };
    case "anchor":
      return { label: "from anchor", source: `&${origin.name}` };
    case "reference":
      return { label: "from reference", source: `[${origin.path.join(", ")}]` };
    case "include":
      return { label: "from included file", source: origin.file };
  }
}

export const ORIGIN_HINT =
  "This value is inherited. Changing it writes an explicit override in this job and never touches the template.";

/** La phrase ci-dessus promet une surcharge possible, ce qui est faux sur un job venu d'un fichier
 *  inclus : il n'y a rien à surcharger ici, puisque Keelson n'écrit pas ce fichier. L'afficher là
 *  contredisait la garantie centrale du lot, au moment précis où l'utilisateur cherche à savoir ce
 *  qu'il peut toucher. Relevé par la passe `critique` du 2026-10-23. */
export const INCLUDE_ORIGIN_HINT =
  "This value comes from an included file. Keelson never writes to included files, so it cannot be overridden here.";

export function hintFor(origin: Origin): string {
  return origin.kind === "include" ? INCLUDE_ORIGIN_HINT : ORIGIN_HINT;
}
