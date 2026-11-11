# ADR 0006 — Jamais de YAML fusionné : la fusion est une chaîne de définitions

Date : 2026-10-23 · Décidé par : le pilote · Statut : accepté

## Contexte

GitLab fusionne la configuration des `include` puis applique le fichier principal par-dessus :
« After all configuration added with `include` is merged together, the main configuration is merged
with the included configuration » (<https://docs.gitlab.com/ci/yaml/includes/>, consulté le
2026-10-23). Les maps fusionnent en profondeur, les listes écrasent.

Keelson doit rendre une IR qui reflète cette valeur effective, **et** garder la capacité d'éditer en
place : chaque élément de l'IR porte une plage d'octets, et `apply` réécrit par splice sans jamais
régénérer le document.

## Options

**A. Fabriquer un document fusionné.** Construire un YAML — ou un CST — qui soit le résultat de la
fusion, puis le parser comme un seul fichier. L'IR serait juste, et toutes les plages seraient des
offsets dans un texte **qui n'existe sur aucun disque**. L'édition en place devient impossible : on
ne peut pas réécrire un octet d'un fichier à partir d'une position dans un document synthétique, et
l'invariant « parse → emit sans modification rend des octets identiques » perd son sens.

**B. Une chaîne ordonnée de définitions.** Chaque fichier garde son propre CST. Pour une clé de
premier niveau définie dans plusieurs fichiers, on conserve la **liste** de ses définitions dans
l'ordre de fusion, et la résolution d'une valeur prend la dernière qui la déclare — exactement le
mécanisme qui résout déjà `extends` et les anchors de merge dans `resolve.ts`.

## Décision

**B.** Keelson ne fabrique jamais de YAML fusionné. `sourcesFor` prend une liste de `Definition`
(`{ map, file }`) au lieu d'une seule map, et `matches(...).at(-1)` donne la valeur qui gagne.

## Conséquences

- Les plages restent **vraies dans leur fichier**. C'est pourquoi `Job`, `Template`, `Stage`,
  `OpaqueBlock` et `Diagnostic` portent tous un `file` : une plage sans fichier ne situe plus rien
  dès qu'il y a plus d'un texte. Lire un offset dans le mauvais texte afficherait des octets pris
  ailleurs, ce qui est le défaut le plus dangereux que ce lot pouvait introduire — la seule surface
  du produit dont la promesse est « ceci est verbatim ».
- L'ordre de fusion de GitLab tombe gratuitement : il suffit de ranger les définitions dans le bon
  ordre et de laisser `at(-1)` faire le reste. Les quatre cas — includes d'abord, dernier inclus
  gagnant, fichier principal en dernier, doublons non dédoublonnés — sont des propriétés de la liste,
  pas du code de fusion.
- Le **propriétaire** d'un élément est son dernier contributeur, donc le fichier qu'un utilisateur
  éditerait. Un job venu d'un include et redéfini dans le fichier principal appartient au fichier
  principal et reste éditable ; un job qui n'est que dans l'include ne l'est pas.
- `Origin` gagne `{ kind: "include", file }` : une valeur qui vient de la définition homonyme d'un
  autre fichier dit lequel, au même titre qu'une valeur venue d'un `extends` ou d'un anchor.
- Ce que la décision **ne** donne pas : la fusion profonde complète de GitLab sur les clés que l'IR
  ne modélise pas. Deux fichiers qui définissent chacun une partie d'un `artifacts:` du même job
  rendent, à l'écran, le bloc opaque du dernier, et non leur fusion. L'IR ne modélisant pas
  `artifacts`, elle ne peut pas la fusionner sans fabriquer précisément le document que cette
  décision refuse. Les blocs opaques d'un job viennent donc de **toutes** ses définitions, dédoublés
  par clé en gardant la dernière, chacun avec son fichier — ce qui est vrai de chaque bloc pris
  isolément, et incomplet de leur combinaison.
