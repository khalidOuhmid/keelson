# ADR 0007 — Ce qui dégrade une cible `extends` absente

Date : 2026-11-04 · Décidé par : Khalid · Statut : accepté

## Contexte

`Pipeline.unresolved` a deux familles depuis la fin de L2b : les includes qu'on ne peut pas lire
(formes distantes, `local` sans lecteur) et les `include: local` cassés. Elle répond à la question de
l'écran : que manque-t-il au pipeline affiché ? La sévérité d'`EXTENDS_TARGET_NOT_FOUND` en dépendait
aussi, de sorte qu'un chemin d'include mal écrit dégradait une erreur en avertissement. Le lot L2b
demandait pourtant de ne dégrader que si un include distant non résolu peut expliquer l'absence.

## Décision

La sévérité suit la seule première famille. Un include local cassé laisse `error`, parce que rien
n'y est inconnu : sa cause est un `INCLUDE_NOT_FOUND` en erreur, et une fois celle-ci corrigée le
diagnostic disparaît ou devient exact. Un include distant, ou un `local` qu'on n'a pas cherché, laisse
`warning`, parce que la cible peut réellement s'y trouver.

## Conséquences

- Un pipeline peut être partiel (`isPartial`) et rendre quand même `error` : les deux répondent à
  deux questions différentes, et `Pipeline.unresolved` ne décide plus de la sévérité.
- Un seul chemin mal écrit peut produire deux erreurs liées. C'est assumé : chacune est vraie.
