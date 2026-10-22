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
  uniquement, dans `types/`). Les types globaux sont cloisonnés par projet — voir la contrainte de
  runtime Node ci-dessous.
- **Biome** pour le lint et le format. Pas d'ESLint, pas de Prettier.
- **UI** (`packages/ui`) : React 19 + Vite + Tailwind CSS v4. Tests de composants avec `bun test` +
  Testing Library + happy-dom (preload `scripts/test-preload.ts` déclaré dans `bunfig.toml`). E2E
  avec Playwright (`packages/ui/e2e/*.e2e.ts`).

### Contrainte de runtime Node (impérative)

Les packages exécutés chez l'utilisateur — `cli`, `core`, `taxonomy`, `catalog`, `adapter-gitlab`,
`adapter-github`, `toolchain` — n'utilisent **aucune API propre à Bun** dans leurs `src/` : ni
`Bun.*`, ni `bun:*`. Ils sont buildés avec `bun build --target=node` pour que `npx keelson`
fonctionne sur Node ≥ 20 sans Bun installé. Bun reste l'outillage de développement.

Deux barrières indépendantes la font respecter :

1. **Le typecheck.** Le `tsconfig.json` de chaque package runtime déclare `"types": ["node"]` et
   n'inclut que `src/` : les types de Bun n'y sont pas visibles, donc `tsc -b` refuse toute
   référence à `Bun` ou à `bun:*`. Les dossiers `test/` de ces packages sont typés à part par
   `tsconfig.tests.json` à la racine (`"types": ["bun", "node"]`, `noEmit`), et peuvent donc
   utiliser `bun:test` librement. `bun run typecheck` enchaîne les deux passes.
   `scripts/` et `packages/ui` gardent les types de Bun.
2. **Le garde-fou `scripts/check-runtime.ts`**, vérifié par `scripts/check-runtime.test.ts` : il
   échoue si un fichier `src/` d'un package runtime importe `bun:*` ou référence `Bun.`. Il attrape
   ce que le typecheck ne peut pas voir (fichiers non inclus dans un projet, usages dans des
   chaînes, `globalThis.Bun`).

En ajoutant un package runtime, lui donner `"types": ["node"]`, l'inscrire dans `RUNTIME_PACKAGES`
de `scripts/check-runtime.ts` et ajouter son `test/` à `tsconfig.tests.json`.

### Dépendances installées

| Dépendance      | Où                              | Usage                                        |
| --------------- | ------------------------------- | -------------------------------------------- |
| `yaml` (eemeli) | `adapter-gitlab`                | parsing, ranges des nœuds, anchors, merge     |
| `zod` v4        | `core`, `adapter-gitlab`        | schémas des opérations                        |
| `@xyflow/react` | `ui`                            | rendu du graphe pipeline                      |
| `elkjs`         | `ui`                            | mise en page en couches, déterministe         |
| `zustand`       | `ui`                            | état de l'UI, undo/redo                       |
| CodeMirror 6    | `ui`                            | blocs YAML opaques en lecture seule           |
| `fast-check`    | devDependency racine            | tests de propriétés                           |

Aucune dépendance n'est aujourd'hui en attente d'un lot futur.

`commander` n'a finalement pas été installé : la CLI parse ses arguments à la main, ce qui suffit
tant que les commandes restent simples et évite une dépendance dans le bundle `npx keelson`.

## Scripts racine

| Script               | Effet                                                  |
| -------------------- | ------------------------------------------------------ |
| `bun run lint`       | `biome check .`                                         |
| `bun run format`     | `biome check --write .`                                 |
| `bun run typecheck`  | `tsc -b` puis `tsc -p tsconfig.tests.json`              |
| `bun run test`       | `bun test` sur tous les packages                        |
| `bun run build`      | build de tous les packages, CLI ciblée Node             |
| `bun run e2e`        | Playwright                                              |
| `bun run check`      | lint + typecheck + test + build — ce que lance la CI    |
| `bun run corpus:update` | régénère les goldens IR du corpus (diff à relire)   |
| `bun run dev`        | serveur local sur la fixture de dev + Vite sur 5283     |

## Développement du front

`bun run dev` démarre deux processus :

1. `scripts/dev.ts` lance le serveur **par programme** (pas via la CLI) sur
   `packages/ui/dev-fixture/`, port 5284, avec un token fixe de développement ;
2. Vite sert l'UI sur **5283** et proxifie `/api` vers le serveur en ajoutant l'en-tête du token,
   de sorte que l'UI de dev n'a pas besoin de token dans son URL.

`changeOrigin` est indispensable dans ce proxy : il réécrit l'en-tête `Host` vers `127.0.0.1:5284`,
que le contrôle de `Host` du serveur exige. Un test
(`packages/ui/test/devProxy.test.ts`) garde la cohérence du token, du port et de cette option entre
le script et la configuration Vite.

La fixture de dev est un pipeline volontairement riche : quatre stages, needs en forme objet et
optionnels, `extends`, environnement. Les tests E2E en prennent une copie temporaire.

## Tests de propriétés

Les propriétés fast-check vivent dans `packages/adapter-gitlab/test/properties/`. Elles vérifient
l'aller-retour, l'inversabilité, le déterminisme et la localité des éditions sur tout le corpus.

- `KEELSON_FC_RUNS` fixe le nombre de runs (25 par défaut, pour garder `bun run test` sous deux
  secondes). Avant une PR qui touche `adapter-gitlab`, passer `KEELSON_FC_RUNS=500`.
- `KEELSON_FC_SEED` force un seed. En CI le seed est fixé à `20261020` pour que les échecs soient
  reproductibles ; en local il est aléatoire, et fast-check affiche le seed et le contre-exemple
  minimal en cas d'échec.

Le corpus est dans `packages/adapter-gitlab/test/corpus/` : `gitlab-templates/` (20 templates
officiels MIT, provenance et SHA dans `LICENSES.md`, intégrité dans `CHECKSUMS.txt`), `edge-cases/`
(fixtures maison) et `goldens/` (IR attendue). **Ne jamais ajouter de fichier de CI venant d'un
employeur ou d'un client.**

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
