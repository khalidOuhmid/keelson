# Keelson

Concevoir visuellement une chaîne DevSecOps avant de l'implémenter : le pipeline CI en aller-retour
avec son YAML natif, les services de la plateforme autour du pipeline, un overlay de couverture des
13 couches de l'OWASP DevSecOps Guideline, et un catalogue d'outils qui propose des implémentations
pour les couches non couvertes.

**Statut : en développement.** Rien n'est encore utilisable. Le socle du monorepo est posé (lot L0),
la logique métier arrive aux lots suivants — voir [specs/01-plan.md](specs/01-plan.md).

## Usage visé

```sh
npx keelson start          # ouvre l'UI web locale sur le dépôt courant
keelson validate           # valide pipeline et toolchain
keelson coverage           # couverture des couches OWASP DevSecOps
keelson export             # export vers un format tiers
```

## Développement

Prérequis : [Bun](https://bun.com) pour l'outillage, Node ≥ 20 pour exécuter le binaire buildé.

```sh
bun install                # installe les dépendances du workspace
bun run check              # lint + typecheck + tests + build (ce que lance la CI)
bun run e2e                # tests Playwright
bun run --cwd packages/ui dev   # UI en développement sur http://localhost:5283
```

Détail des scripts et des conventions : [CLAUDE.md](CLAUDE.md).

## Licence

Apache-2.0 — Copyright 2026 Khalid Ouhmid.
