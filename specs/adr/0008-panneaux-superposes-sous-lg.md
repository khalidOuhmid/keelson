# ADR 0008 — Panneaux superposés sous `lg`

Date : 2026-11-04 · Décidé par : le pilote · Statut : accepté

## Contexte

`DESIGN.md` refusait tout point de rupture : une seule composition, trois colonnes, un défilement
horizontal sous sa largeur. Mesuré à 375 px, sélectionner un nœud ouvrait le panneau de détail
entièrement hors de la fenêtre, et ce panneau ne peut pas revendiquer l'exception de WCAG 1.4.10
pour un contenu bidimensionnel, que le graphe seul peut invoquer.

## Décision

Sous `lg` et là seulement, le panneau de détail, la barre gauche et la fiche outil passent en
superposition plein écran. La barre gauche s'ouvre par un bouton `Panel`, le graphe garde la fenêtre.
Le comportement desktop ne change pas.

## Conséquences

- Une exception nommée à la règle : c'est le seul point de rupture du produit, et il ne touche que le
  placement de ces trois panneaux, jamais leur contenu.
- Le focus n'est pas piégé dans la superposition : cela reste l'écart du 2026-10-22 sur la politique
  de focus.
