# Keelson

## Le projet en cinq lignes

Keelson est un outil open source qui sert à concevoir visuellement une chaîne DevSecOps avant de
l'implémenter. Il lit et réécrit le YAML CI natif d'un dépôt (GitLab CI d'abord, GitHub Actions
ensuite) en aller-retour sans le dénaturer, et modélise à côté les services de la plateforme (Nexus,
Harbor, DefectDojo, Vault, Sentry…) et leurs intégrations avec les jobs. Un overlay indique la
couverture des 13 couches de l'OWASP DevSecOps Guideline, plus des catégories plateforme hors OWASP,
et un catalogue de 50 à 100 outils propose des implémentations pour les couches non couvertes.

Plan détaillé et découpage en lots : [specs/01-plan.md](specs/01-plan.md). Vision :
[specs/00-vision.md](specs/00-vision.md).

## Règles de travail (non négociables)

- **Mode final, pas de POC. TDD strict.** Pour chaque comportement : écrire le test, constater qu'il
  échoue, puis implémenter. Aucun code non testé.
- **Toute dette est datée dans le code** : `// DETTE(AAAA-MM-JJ): <quoi> — <pourquoi>`.
- **Tout ce qui est hors périmètre du lot en cours va dans [specs/ecarts.md](specs/ecarts.md)**
  (date, constat, impact, proposition). Jamais dans le lot courant.
- Pas de commentaires explicatifs superflus dans le code.
- Ne pas installer de dépendance non utilisée par le lot en cours.
- **Commits conventionnels** (`chore:`, `build:`, `test:`, `docs:`, `ci:`, `feat:`, `fix:`) sur une
  branche `lot/<id>-<slug>`.

## Vérification avant toute PR

```sh
bun run check && bun run e2e
```

## Stack

- **Bun** : gestionnaire de paquets, workspaces, scripts, runner de tests (`bun test`). Versions
  figées par `bun.lock`.
- **TypeScript** strict partout (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`), project references, `tsc -b` pour le typecheck (déclarations
  uniquement, dans `types/`).
- **Biome** pour le lint et le format. Pas d'ESLint, pas de Prettier.
- **UI** (`packages/ui`) : React 19 + Vite + Tailwind CSS v4. Tests de composants avec `bun test` +
  Testing Library + happy-dom (preload `scripts/test-preload.ts` déclaré dans `bunfig.toml`). E2E
  avec Playwright (`packages/ui/e2e/*.e2e.ts`).

### Contrainte de runtime Node (impérative)

Les packages exécutés chez l'utilisateur — `cli`, `core`, `taxonomy`, `catalog`, `adapter-gitlab`,
`adapter-github`, `toolchain` — n'utilisent **aucune API propre à Bun** dans leurs `src/` : ni
`Bun.*`, ni `bun:*`. Ils sont buildés avec `bun build --target=node` pour que `npx keelson`
fonctionne sur Node ≥ 20 sans Bun installé. Bun reste l'outillage de développement.

Le garde-fou est `scripts/check-runtime.ts`, vérifié par `scripts/check-runtime.test.ts` : il échoue
si un fichier `src/` d'un package runtime importe `bun:*` ou référence `Bun.`. Les fichiers de test
peuvent utiliser `bun:test` librement.

### Dépendances prévues pour les lots suivants

À ne pas installer avant le lot qui les utilise :

| Dépendance        | Usage                                                  | Lot    |
| ----------------- | ------------------------------------------------------ | ------ |
| `yaml` (eemeli)   | adaptateurs CI, API Document/CST, aller-retour         | L1     |
| `commander`       | parsing des commandes de la CLI                        | L1     |
| `zod` v4          | schémas du catalogue et de la toolchain                | L3, L4 |
| `@xyflow/react`   | rendu des graphes pipeline et toolchain                | L2     |
| CodeMirror 6      | édition des blocs YAML opaques                         | L2     |
| Zustand           | état de l'UI                                           | L2     |

## Scripts racine

| Script               | Effet                                                  |
| -------------------- | ------------------------------------------------------ |
| `bun run lint`       | `biome check .`                                         |
| `bun run format`     | `biome check --write .`                                 |
| `bun run typecheck`  | `tsc -b`                                                |
| `bun run test`       | `bun test` sur tous les packages                        |
| `bun run build`      | build de tous les packages, CLI ciblée Node             |
| `bun run e2e`        | Playwright                                              |
| `bun run check`      | lint + typecheck + test + build — ce que lance la CI    |

## Workflow front avec Impeccable (obligatoire pour tout changement dans `packages/ui`)

Le plugin [Impeccable](https://github.com/pbakaus/impeccable) juge et guide tout le front.

1. **Avant** de coder une vue ou un composant : `/impeccable shape`.
2. **Après** implémentation : `/impeccable critique` puis `/impeccable audit`, et corriger ce qui en
   ressort.
3. **Avant** d'ouvrir la PR : `/impeccable polish`.
4. `PRODUCT.md` et `DESIGN.md` (générés par `/impeccable init`) sont la **source de vérité du
   design** : aucune couleur, taille ou espacement en dur hors des tokens qu'ils définissent.

## Organisation du monorepo

```
packages/core/            IR pipeline + toolchain
packages/taxonomy/        couches OWASP + catégories plateforme
packages/catalog/         tools/*.yaml, logos/, schéma
packages/adapter-gitlab/  GitLab CI ↔ IR
packages/adapter-github/  GitHub Actions ↔ IR
packages/toolchain/       .devsecops/toolchain.yaml, inférence des intégrations
packages/ui/              React + Vite + Tailwind
packages/cli/             binaire `keelson`
scripts/                  outillage de dev (garde-fou runtime, preload des tests)
specs/                    vision, plan, écarts
```

Chaque package exporte une constante `PACKAGE_NAME` égale au nom de son `package.json`, vérifiée par
un test : c'est le smoke test du workspace, de la résolution et de `bun test`. Ne pas la supprimer.
