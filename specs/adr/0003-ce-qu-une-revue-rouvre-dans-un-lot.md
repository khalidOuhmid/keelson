# ADR 0003 — Ce qu'une revue rouvre dans un lot

Date : 2026-10-22 · Décidé par : le pilote · Statut : accepté

## Contexte

La passe `/impeccable critique` du lot L2 (étape 9) a rendu **20/40** et remonté trois défauts P0.
Deux d'entre eux ne sont pas des défauts de finition mais des **défauts de correction dans des
étapes déjà livrées et déjà commitées** du même lot :

- la vue Pipeline dessine `lint`, un job de stage `test`, à l'intérieur de la colonne `build`, dont
  l'en-tête annonce « 1 job » — sur la fixture de dev du projet, dans la capture livrée (étape 3) ;
- `JobEditor` est monté sans `key`, donc l'état local d'un job sélectionné survit à la sélection du
  suivant : le champ « Job id » propose l'ancien nom et `Rename` réécrit le YAML avec une valeur que
  l'utilisateur n'a jamais tapée (étape 5).

Les deux étaient verts au test. `layout.test.ts` et `graph.test.ts` vérifient que la mise en page est
**calculée**, jamais qu'elle est **vraie** ; aucun test ne monte `JobEditor` deux fois avec deux jobs
différents.

La règle de pilotage dit : « ce qui est hors périmètre du lot en cours va dans `specs/ecarts.md`,
jamais dans le lot ». Appliquée à la lettre, elle enverrait ces deux défauts en écart et permettrait
de fusionner L2 en sachant que sa vue principale affiche un job dans la mauvaise colonne.

## Options

1. **Tout en écart, fusionner L2 tel quel.** Respecte la lettre de la règle. Fusionne dans `main` une
   vue qui ment sur la donnée qu'elle existe pour montrer, et un éditeur qui peut réécrire un nom que
   l'utilisateur n'a pas saisi. L'écart deviendrait le lieu où l'on range ce qu'on ne veut pas
   corriger, ce qui le vide de son sens.
2. **Tout traiter dans L2.** Inclut la navigation clavier complète du graphe et l'affichage du diff
   après écriture, qui sont des surfaces d'interaction nouvelles exigeant une passe `shape`. Le lot
   n'aurait plus de bord : chaque revue en ajouterait un morceau.
3. **Trancher par nature du défaut, pas par date de découverte.**

## Décision

Option 3. Le critère est **ce que le lot a promis**, pas la date à laquelle le défaut est apparu.

- **Rouvre le lot** : tout défaut qui fait qu'une étape déjà livrée *ne tient pas ce qu'elle
  annonçait* — la vue affiche faux, l'édition écrit une valeur non saisie, un contrôle rendu est
  mort, un état déclaré load-bearing par le surface brief n'est pas rendu, un engagement explicite de
  `PRODUCT.md` (WCAG 2.1 AA) n'est pas tenu. Ce sont des `fix:` sous TDD dans la branche du lot, avec
  d'abord le test qui échoue.
- **Part en écart** : toute **surface d'interaction nouvelle**, même si la revue la juge
  souhaitable — navigation du graphe aux flèches, palette de commandes, recherche, affichage du diff
  après écriture, posture de lecture seule. Ces sujets exigent une passe `/impeccable shape` avant
  d'être codés, et `shape` ouvre un lot, il n'en termine pas un.

La ligne de partage, en une phrase : **une revue peut rouvrir une promesse, jamais en ajouter une.**

## Conséquences

- La règle « hors périmètre → écart » se lit désormais : hors périmètre signifie *non promis par le
  lot*, pas *découvert tard*. `specs/ecarts.md` reste le registre de ce qui est reporté, jamais celui
  de ce qui est abandonné.
- L2 ne peut pas fusionner tant que les défauts de la première catégorie ne sont pas corrigés, test
  d'abord. Sa définition de terminé dans `specs/lots/l2.md` est donc étendue d'un point : *aucun
  défaut ouvert de catégorie « promesse non tenue »*.
- Un test d'invariant de mise en page est ajouté : le centre de tout nœud de job tombe dans la boîte
  de la colonne de **son** stage, vérifié sur l'ensemble des fixtures. Le défaut P0 de colonne est né
  de tests qui vérifiaient un calcul sans vérifier une vérité ; c'est cette classe de test qui
  manquait, pas un cas particulier.
- Conséquence assumée : les lots s'allongent quand une revue est sévère. C'est le prix du « mode
  final, pas de POC ». Un lot fusionné doit pouvoir être montré.
