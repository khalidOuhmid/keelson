# ADR 0011 — Un service déclaré couvre les couches de son outil

**Statut** : accepté, 2026-11-04.

## Contexte

Les catégories plateforme vivent autour du pipeline : aucun job ne prouve un Nexus ou un GitLab.
L3 les disait donc « not seen » même quand l'équipe les opère.

## Décision

`coverage` reçoit les services de la toolchain. Une couche est couverte par un job détecté ou par un
service déclaré dont l'outil la porte, et le résultat nomme les deux. Déclarer un service reste une
affirmation de l'utilisateur, et le panneau dit qu'elle vient de la toolchain.

## Conséquences

`keelson coverage --require scm` devient satisfaisable. Un service déclaré pour une couche OWASP
(Wiz, DefectDojo) la couvre aussi : c'est un constat de présence, pas d'usage.
