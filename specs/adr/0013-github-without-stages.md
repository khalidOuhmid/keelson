# ADR 0013 — GitHub Actions n'a pas de stages : ils sont dérivés

**Statut** : accepté, 2026-11-05.

## Contexte

L'IR et la vue Pipeline sont organisées en stages. Un workflow n'en a pas : l'ordre vient de `needs`.
Un job par workflow et un graphe sans colonnes demanderaient une seconde vue, et un nouveau champ
partout où l'IR dit `stage`.

## Décision

L'adaptateur dérive des stages implicites : `level 1` pour les jobs sans `needs`, puis un niveau de
plus que le plus haut de ses dépendances. Rien de cela n'existe dans le fichier. `Pipeline.provider`
vaut `github`, et l'UI retire ce qui n'a pas de sens : contrôles de stages, stage d'un job, `optional`
et `artifacts` d'un need. `addStage`, `moveStage` et `setJobStage` sont refusés par
`INVALID_OPERATION notForProvider`, comme un need à options.

Un job `uses:` appelle un workflow réutilisable que Keelson ne lit pas : `WORKFLOW_UNRESOLVED`, et
`Pipeline.unresolved` le compte, donc la couverture est une borne basse.

## Conséquences

Chaque workflow est un document : un dépôt en a plusieurs, et le workspace les liste tous. Les goldens
de GitLab ne bougent pas, `provider` y est absent.
