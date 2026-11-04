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

/** Une valeur venue d'un fichier inclus, sur un job du fichier principal : `setJobStage` y écrit
 *  bien une surcharge, et le fichier inclus n'est pas touché. */
export const INCLUDE_ORIGIN_HINT =
  "This value comes from an included file. Changing it writes an explicit override in this job and never touches that file.";

/** Sur un job inclus, aucune valeur ne se surcharge, quelle que soit son origine : Keelson n'écrit
 *  pas ce fichier. */
export const READ_ONLY_ORIGIN_HINT =
  "This job is defined in an included file. Keelson never writes to included files, so this value cannot be overridden here.";

/** Le texte dépend du job **et** de l'origine : regarder l'origine seule promettait une surcharge
 *  impossible sur un job inclus, ou la refusait sur un job surchargé dans le fichier principal. */
export function hintFor(origin: Origin, readOnly: boolean): string {
  if (readOnly) {
    return READ_ONLY_ORIGIN_HINT;
  }
  return origin.kind === "include" ? INCLUDE_ORIGIN_HINT : ORIGIN_HINT;
}
