# ADR 0012 — Une opération composite a un seul inverse

**Statut** : accepté, 2026-11-05.

## Contexte

Insérer un outil peut demander un stage et un job. Deux opérations feraient deux pas d'annulation,
et un échec de la seconde laisserait la première écrite.

## Décision

`composite` applique ses étapes en mémoire, dans l'ordre, et n'écrit que si toutes passent. L'inverse
et `touched` sont calculés sur le texte final : la plage va du premier au dernier octet différent. Les
étapes admises sont limitées à celles qui ajoutent : `addStage`, `addJob`, `addNeed`, `addSnippet`.

## Conséquences

Une composite touche une seule plage, parfois large : un stage en tête et un job en fin de fichier
couvrent le milieu, qui reste octet pour octet identique. Le diff de l'UI se calcule donc par lignes,
pas depuis `touched`.
