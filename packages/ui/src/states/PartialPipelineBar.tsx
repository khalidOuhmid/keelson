import type { Pipeline, UnresolvedInclude } from "@keelson/core";
import { isPartial } from "@keelson/core";
import { ChevronRightIcon } from "../icons.tsx";

export const PARTIAL_HINT =
  "Some includes are not resolved, so jobs may be missing from this view.";

export function unresolvedCount(count: number): string {
  return `${count} unresolved ${count === 1 ? "include" : "includes"}`;
}

export type PartialPipelineBarProps = {
  pipeline: Pipeline;
};

/** Trois choses la séparent de `NoticeBar`, et toutes les trois sont intentionnelles : aucune
 *  teinte de sévérité — un include non résolu est une lacune, pas une erreur —, **aucun bouton
 *  `Dismiss``**, parce qu'un fait ne se congédie pas, et aucune région live, parce que ce n'est pas
 *  un événement mais un état du fichier. */
export function PartialPipelineBar({ pipeline }: PartialPipelineBarProps) {
  if (!isPartial(pipeline)) {
    return null;
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: un landmark de plus noierait la liste des repères ; ce bloc est un groupe nommé
    <div
      role="group"
      aria-label="Partial pipeline"
      className="max-h-1/3 shrink-0 overflow-y-auto border-b border-border-subtle bg-surface-1 px-3 py-1.5"
    >
      <details className="group">
        {/* `py-1.5` porte la hauteur de la cible de 20 px — mesurée — à 32 px. */}
        <summary className="flex cursor-pointer flex-wrap items-center gap-1.5 py-1.5 text-sm text-text-secondary">
          <ChevronRightIcon className="transition-transform duration-fast ease-out group-open:rotate-90" />
          <span className="text-2xs font-semibold tracking-label text-text-muted uppercase">
            Partial pipeline
          </span>
          <span className="font-mono text-2xs text-text-muted tabular-nums">
            {unresolvedCount(pipeline.unresolved.length)}
          </span>
          <span>{PARTIAL_HINT}</span>
        </summary>
        <ul className="mt-1.5 flex flex-col gap-1">
          {/* La clé porte la plage, pas l'index : GitLab ne dédoublonne pas les includes, donc le
              même fichier peut déclarer deux fois la même valeur, et seule la position les
              distingue. */}
          {pipeline.unresolved.map((entry) => (
            <li
              key={`${entry.from}:${entry.range?.start ?? "?"}:${entry.detail}`}
              className="flex flex-wrap items-center gap-1.5"
            >
              <Body entry={entry} />
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** Aucune entrée n'est cliquable. La première version en faisait un bouton appelant
 *  `selectByRange`, et c'était un **clic mort** : la plage d'un include tombe dans le bloc opaque
 *  de la clé `include` de premier niveau, que `selectByRange` ne peut par construction jamais
 *  apparier à un job. Un contrôle sans effet est soit branché, soit supprimé. */
function Body({ entry }: { entry: UnresolvedInclude }) {
  return (
    <>
      <span className="shrink-0 rounded-sm border border-border-default px-1 text-2xs tracking-label text-text-muted uppercase">
        {entry.form}
      </span>
      <span className="font-mono text-xs break-all text-text-secondary">{entry.detail}</span>
      <span className="text-2xs tracking-label text-text-muted uppercase">declared in</span>
      <span className="font-mono text-xs text-text-muted">{entry.from}</span>
    </>
  );
}
