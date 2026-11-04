# Lot L2b-fix — ce que le rapport de L2b n'avait pas dit

Cadrage écrit depuis `main` à `3a79f9f`. Quatre manques de L2b, dans l'ordre fixé par Khalid.

## 1. Preuves rouges des cinq correctifs non prouvés

Chaque défaut réel est réintroduit, le test doit rougir, le fichier est restauré **par réécriture**
et `git diff` vérifié vide sur ce fichier. Ni `git stash` ni `git checkout-index` : c'est un
`checkout-index` qui a détruit un correctif pendant L2b.

| # | Correctif | Défaut réintroduit | Fichier |
| --- | --- | --- | --- |
| 1 | Lien symbolique hors racine | lecture sans contrôle du chemin réel | `adapter-gitlab/src/reader.ts` |
| 2 | Précédence d'`extends` | sources du template entrelacées avec les définitions | `adapter-gitlab/src/resolve.ts` |
| 3 | `isPartial` sur include local cassé | `failed` hors de `Pipeline.unresolved` | `adapter-gitlab/src/parse.ts` |
| 4 | Blocs opaques d'un job surchargé | blocs pris sur la seule dernière définition | `adapter-gitlab/src/parse.ts` |
| 5 | Texte d'aide du badge d'origine | `hintFor` rend toujours `ORIGIN_HINT` | `ui/src/views/pipeline/origin.ts` |

Un test qui ne rougit pas est remplacé par un test qui rougit, et consigné au journal avec sa cause.

## 2. Sévérité d'`EXTENDS_TARGET_NOT_FOUND`

| Situation | Sévérité | Raison |
| --- | --- | --- |
| tous les includes résolus | `error` | rien ne peut expliquer l'absence |
| include **local cassé**, seul | `error` | sa cause est déjà une erreur nommée, à corriger ; rien n'est inconnu |
| include **distant** non résolu, cassé ou non à côté | `warning` | sa cible peut venir d'un fichier que Keelson ne lit pas |
| `parse` sans lecteur | `warning` | le `local` n'a pas été cherché, il n'est pas cassé |

La sévérité suit donc `resolution.unresolved` et non la liste fusionnée `Pipeline.unresolved`, qui
reste ce qu'elle dit : ce qui manque au pipeline affiché. **ADR 0007.**

## 3. Texte d'aide du badge d'origine

Le texte dépend de **deux** choses, le job et l'origine, pas de l'origine seule :

| Job | Origine | Texte |
| --- | --- | --- |
| fichier principal | `extends`, anchor, `!reference`, défaut | `ORIGIN_HINT`, inchangé |
| fichier principal | `include` | la surcharge s'écrit dans ce job, le fichier inclus n'est pas touché |
| fichier inclus | toutes | rien ne se surcharge ici |

`OriginBadge` gagne `readOnly`. La promesse « la surcharge s'écrit » est prouvée au niveau de `apply`,
pas seulement à l'écran.

## 4. `/impeccable polish`

Sur `packages/ui/src`, la passe que L2b devait exécuter en fin de lot.

## Arborescence touchée

```
packages/adapter-gitlab/src/parse.ts            extendsSeverity
packages/adapter-gitlab/test/includes.test.ts   sévérité
packages/adapter-gitlab/test/operations/includes.test.ts   surcharge d'une valeur venue d'un include
packages/core/src/ir.ts                         commentaire de UnresolvedInclude
packages/ui/src/views/pipeline/{origin.ts,OriginBadge.tsx}
packages/ui/src/panels/JobDetailPanel.tsx
packages/ui/test/includes.test.tsx
specs/{diagnostics.md,ecarts.md,progress.md,adr/0007-*.md}
```

## Définition de terminé

1. Cinq preuves rouges consignées, restauration vérifiée à chaque fois.
2. Les quatre lignes de la table de sévérité sont chacune un test prouvé rouge.
3. Les trois lignes de la table du texte d'aide sont chacune un test sur le DOM rendu, prouvé rouge.
4. `polish` exécuté et ses constats traités ou consignés.
5. Revue indépendante en lecture seule, triage par l'ADR 0003.
6. `bun install --frozen-lockfile && bun run check && bun run e2e` depuis un arbre sans `dist/`,
   smoke test Node du binaire.
7. `merge --no-ff` dans `main`, `bun run check` sur `main`, journal, « Prochaine action : L3, cadrage ».
