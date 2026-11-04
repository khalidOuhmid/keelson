# ADR 0009 — `.devsecops/toolchain.yaml` s'édite par patch en place

**Statut** : accepté, 2026-11-04.

## Contexte

Le fichier appartient à Keelson mais il se relit en diff et se corrige à la main : c'est là que
l'utilisateur confirme une inférence. Le réécrire en entier perdrait commentaires et ordre.

## Décision

Le fichier se lit par `yaml` et s'écrit par des remplacements de plages, comme le CI natif. Chaque
opération rend un `splice` inverse. `services` est une map : l'identifiant est la clé, donc l'unicité
vient du format. Une section en flow non vide est refusée par `INVALID_OPERATION`.

## Conséquences

Les quatre propriétés de `adapter-gitlab` s'appliquent telles quelles. Le fichier absent vaut une
toolchain vide : la première opération le crée, et son inverse le rend vide, sans le supprimer.
