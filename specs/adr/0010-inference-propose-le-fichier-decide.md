# ADR 0010 — L'inférence propose, le fichier décide

**Statut** : accepté, 2026-11-04.

## Contexte

Le plan veut des intégrations inférées depuis les scripts, puis confirmées ou corrigées. Une
inférence écrite d'office ferait de Keelson l'auteur d'affirmations qu'il ne peut pas vérifier.

## Décision

Une fiche `service` porte un champ `integration` : un type par outil. L'inférence calcule des triplets
`(job, tool, kind)` et ne les écrit jamais. Un triplet est confirmé si `integrations` relie ce job à
un service de cet outil avec ce type, écarté s'il figure dans `dismissed`, proposé sinon. `dismissed`
existe parce qu'un faux positif reviendrait à chaque analyse.

## Conséquences

La détection garde ses bornes (`specs/ecarts.md`) sans jamais fausser le fichier. Un outil à plusieurs
usages ne propose qu'un type ; l'utilisateur écrit les autres à la main.
