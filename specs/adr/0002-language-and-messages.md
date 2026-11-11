# ADR 0002 — Langue et messages

Date : 2026-10-22 · Décidé par : Khalid Ouhmid · Statut : accepté

## Contexte

Les messages de diagnostic de `core` et ceux de la CLI sont en français, alors que l'UI est en
anglais depuis le lot L2. Le panneau de diagnostics affiche donc du français dans une interface
anglaise, et `PRODUCT.md` laissait ce point explicitement à trancher.

Deux écarts le consignaient déjà (`specs/gaps.md`, 2026-10-21). Le lot L3 va produire des
**centaines** de messages supplémentaires — couverture OWASP, validation du catalogue, `catalog
lint` — et le lot L7 prévoyait de traiter la langue au moment du packaging. Trancher après L3
obligerait à repasser sur tout ce que L3 aura produit.

Une contrainte structurante existe déjà dans le projet : les codes de diagnostic et d'erreur
d'opération sont des **contrats publics**, documentés dans `specs/diagnostics.md` et vérifiés par
`packages/core/test/diagnostics.contract.test.ts`. Le texte, lui, n'a jamais été un contrat.

## Options

1. **Traduire les messages existants en anglais, sur place.** Le moins coûteux à court terme, mais
   le texte libre reste produit par `core` : la couche d'affichage ne peut ni le reformuler, ni
   l'enrichir, ni le localiser plus tard sans refaire le travail.
2. **Mettre en place une infrastructure de traduction complète maintenant.** Coût immédiat élevé
   pour un besoin que personne n'a exprimé, sur un projet sans utilisateur à ce jour.
3. **Séparer le contrat de son rendu** : `core` ne rend que `code` et `params`, un module unique
   traduit en texte anglais, et l'infrastructure de langue n'est ajoutée que si un besoin réel
   apparaît.

## Décision

Option 3.

- **Langue unique du produit : l'anglais.** UI, CLI, diagnostics, catalogue, documentation destinée
  aux utilisateurs. Les specs, le code et les tests restent en français.
- **`core` et les adaptateurs ne produisent jamais de texte libre.** Chaque diagnostic et chaque
  erreur porte un `code` stable et des `params` structurés et typés.
- **Un module unique `@keelson/core/messages`** transforme `(code, params)` en texte anglais. La CLI
  et l'UI l'utilisent toutes les deux : une seule formulation par code, pour tout le produit.
- **Un test échoue** si un code de `specs/diagnostics.md` n'a pas de message, ou si un message n'a
  pas de code. Il étend le test de contrat existant, qui ne vérifiait jusqu'ici que la présence du
  code dans la documentation.
- `details` est supprimé et fusionné dans `params` : un diagnostic ou une erreur porte uniquement
  `code`, `severity` (pour les diagnostics), `range` (si applicable) et `params`. `JOB_REFERENCED`
  expose `params.referencedBy`.
- **Pas d'infrastructure de traduction** tant qu'aucun besoin réel n'est exprimé.

## Conséquences

- **Lot dédié `L2c — messages`**, intercalé **après la fusion de L2 et avant L3**. L'ordre des lots
  devient : L2, L2c, L2b, L3, L4, L5, L6, L7, L8.
- Les deux écarts de langue du 2026-10-21 sont **clos par cet ADR**.
- Le point « traitement de l'écart de langue » du lot **L7 devient sans objet** et en est retiré.
- `params` devient une partie du contrat public au même titre que le code : en changer la forme est
  une rupture de compatibilité, au même titre que renommer un code. `specs/diagnostics.md` devra
  documenter les `params` de chaque code, pas seulement sa signification.
- L'UI continue de n'appliquer **aucun traitement par code** : elle affiche ce que le module de
  messages rend. La seule exception reste `JOB_REFERENCED`, dont elle lit désormais
  `params.referencedBy` pour lister les jobs référents.
- La suppression de `details` est une **rupture de compatibilité**, assumée : aucune version n'est
  publiée, c'est donc le moment où elle ne coûte rien. Elle touche `OperationError` dans
  `packages/core/src/operations.ts`, la forme d'erreur de l'API du serveur, `ApiFailure` dans
  `packages/ui/src/api/client.ts`, et `referencedBy()` dans `packages/ui/src/editing/drafts.ts`.
- Bénéfice collatéral pour le lot L8 : un client distant qui reçoit `code` et `params` peut
  formuler son propre message sans analyser une chaîne.

Portée complétée le 2026-10-22 : `@keelson/server`, voir l'écart du même jour.
