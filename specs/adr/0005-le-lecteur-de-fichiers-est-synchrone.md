# ADR 0005 — Le lecteur de fichiers inclus est synchrone

Date : 2026-10-23 · Décidé par : le pilote · Statut : accepté

## Contexte

Résoudre les `include: local` oblige `parse` à lire d'autres fichiers que celui qu'on lui donne.
`parse` est aujourd'hui une fonction pure de `texte → IR`, synchrone, et `apply` l'appelle deux fois
par opération pour obtenir l'IR d'avant et celle d'après.

Les packages exécutés chez l'utilisateur n'ont pas le droit d'utiliser une API propre à Bun
(`CLAUDE.md`), mais `node:fs` leur est permis — la CLI et le serveur s'en servent déjà.

## Options

**A. Rendre `parse` asynchrone.** C'est la forme naturelle d'une lecture de disque en Node. Elle
contamine `apply`, donc toute la chaîne d'édition, donc `planFor` et les dix `plan*`, pour un gain
nul : les fichiers inclus sont peu nombreux, petits, et déjà dans le cache du système de fichiers au
moment où le serveur les relit. Elle rendrait aussi `apply` réentrant d'une façon que la file
d'attente par document du serveur devrait reprendre.

**B. Pré-lire les fichiers inclus avant `parse`.** Impossible : savoir *quels* fichiers lire demande
d'avoir résolu le graphe d'include, c'est-à-dire d'avoir parsé chaque fichier pour y trouver sa
propre clé `include`. On ne peut pas pré-lire ce qu'on découvre en lisant.

**C. Injecter un lecteur synchrone.** `parse(text, { file, read })` où `read` est une interface à
deux méthodes, `read(path)` et `candidates()`. L'adaptateur ne connaît pas le disque ; l'appelant
fournit l'implémentation.

## Décision

**C.** Le lecteur est une interface synchrone injectée, et son implémentation sur `node:fs` vit dans
`packages/adapter-gitlab/src/reader.ts`, partagée par la CLI et par le serveur.

## Conséquences

- `parse` reste synchrone, donc `apply` aussi, donc rien de la chaîne d'édition ne change de forme.
- Le module de résolution se teste sur un **objet littéral** — un dépôt en mémoire — donc sans
  disque, et aucun test ne peut passer parce qu'un fichier traîne quelque part.
- Le serveur paie une lecture bloquante par fichier inclus et par chargement. C'est assumé : il sert
  un seul utilisateur sur sa propre machine, et le coût est celui d'un `readFileSync` sur un fichier
  de quelques kilo-octets déjà chaud.
- Une seule implémentation tient la **frontière de la racine** du dépôt. C'est délibéré : deux
  copies de cette frontière seraient deux endroits où la perdre. Elle est vérifiée deux fois — une
  fois sur le chemin normalisé avant toute lecture, une fois sur le chemin résolu juste avant
  `readFileSync` — parce que c'est la dernière ligne avant qu'un serveur local lise le disque pour
  le compte d'une page web ouverte dans le navigateur de l'utilisateur.
- `GitlabDocument` porte `file` et `read`, ce qu'il faut pour **reparser le même pipeline**. Sans
  eux, `apply` relirait le texte sans ses `include` : le garde de cycle et le refus d'éditer un
  fichier inclus porteraient alors sur un pipeline amputé.
- Si un jour les `include` distants sont résolus — lot ultérieur —, leur lecture est une requête
  réseau et cette décision ne tiendra plus telle quelle. Le cache sur disque qu'ils exigeront devra
  être rempli **hors** de `parse`, et le lecteur synchrone lira ce cache.
