# Lot L2c — messages : `code` + `params`, anglais unique, `details` fusionné

Document de cadrage écrit **avant** toute ligne de code, depuis l'inventaire du dépôt à
`b8106c2`. Il exécute l'[ADR 0002](../adr/0002-language-and-messages.md), complété par l'écart du
2026-10-22 sur `@keelson/server`.

## Objet

Séparer le contrat de son rendu. `core`, les adaptateurs et `@keelson/server` ne produisent plus que
`code` + `params` typés ; un module unique `@keelson/core/messages` en rend le texte anglais, et la
CLI comme l'UI passent par lui. `details` disparaît, fusionné dans `params`.

## Inventaire

### 1. Codes existants et leur origine

**Diagnostics** (9 codes, `packages/core/src/diagnostics.ts:12-20`) :

| Code | Émis par | Fichier et ligne |
|---|---|---|
| `INVALID_YAML` | adaptateur | `adapter-gitlab/src/parse.ts:74` |
| `INCLUDE_UNRESOLVED` | adaptateur | `adapter-gitlab/src/parse.ts:88` |
| `EXTENDS_TARGET_NOT_FOUND` | adaptateur | `adapter-gitlab/src/resolve.ts:138` |
| `EXTENDS_CYCLE` | adaptateur | `adapter-gitlab/src/resolve.ts:127` |
| `JOB_WITHOUT_SCRIPT` | adaptateur | `adapter-gitlab/src/parse.ts:153` |
| `UNKNOWN_NEED` | core | `core/src/validate.ts:179` |
| `NEEDS_CYCLE` | core | `core/src/validate.ts:149` |
| `UNKNOWN_STAGE` | core | `core/src/validate.ts:168` |
| `NEED_LATER_STAGE` | core | `core/src/validate.ts:191` |

**Erreurs d'opération** (13 codes, `packages/core/src/operations.ts:6-18`). Deux sites dans `core`
(`parseOperation`), tous les autres dans `adapter-gitlab/src/apply.ts` via son `fail()` local :

| Code | Sites | Fichier et ligne |
|---|---|---|
| `STALE_DOCUMENT` | 1 | `apply.ts:756` |
| `JOB_NOT_FOUND` | 2 | `apply.ts:107`, `apply.ts:113` |
| `JOB_REFERENCED` | 1 | `apply.ts:252` |
| `NAME_CONFLICT` | 2 | `apply.ts:197`, `apply.ts:311` |
| `INVALID_NAME` | 3 | `apply.ts:194`, `apply.ts:308`, `apply.ts:578` |
| `STAGE_NOT_FOUND` | 3 | `apply.ts:200`, `apply.ts:336`, `apply.ts:652` |
| `STAGE_EXISTS` | 1 | `apply.ts:581` |
| `NEED_EXISTS` | 1 | `apply.ts:367` |
| `NEED_NOT_FOUND` | 2 | `apply.ts:447`, `apply.ts:490` |
| `CYCLE` | 1 | `apply.ts:798` |
| `UNSUPPORTED_VERSION` | 1 | `core/src/operations.ts:187` |
| `INVALID_OPERATION` | 8 | voir § 2 |
| `RANGE_OUT_OF_BOUNDS` | 16 | voir § 2 |

**Codes de transport du serveur** (6 codes, **non documentés dans `specs/diagnostics.md`**, non
déclarés comme constantes, écrits en littéral à chaque site) :

| Code | Statut | Sites |
|---|---|---|
| `FORBIDDEN_HOST` | 403 | `server/src/app.ts:63` |
| `FORBIDDEN_TOKEN` | 403 | `server/src/app.ts:77` |
| `METHOD_NOT_ALLOWED` | 405 | `app.ts:84, 93, 103, 159, 179` |
| `NOT_FOUND` | 404 | `app.ts:109, 166, 174, 184` · `store.ts:162, 180` |
| `PAYLOAD_TOO_LARGE` | 413 | `app.ts:116` |
| `INTERNAL_ERROR` | 500 | `server/src/index.ts:58` |

Le serveur réémet par ailleurs `INVALID_OPERATION` pour trois erreurs d'enveloppe
(`app.ts:133, 139, 143`) et relaie tel quel le `code` de `parseOperation` et d'`apply`
(`store.ts:170, 192`).

### 2. Chaînes de message produites hors du futur module

**Toutes** les chaînes ci-dessous disparaissent. Les français sont marqués **FR**.

`packages/core/src/validate.ts` — **FR** : `:152` cycle des needs, `:171` stage inconnu,
`:182` need inconnu, `:194` need en stage ultérieur. Plus `:10` `throw new Error` interne.

`packages/core/src/operations.ts` — **FR** : `:181` « une opération doit être un objet JSON »,
`:189` version non supportée, `:201` `${path} : ${detail}` depuis zod.

`packages/adapter-gitlab/src/parse.ts` — `:77` `error.message` de la lib `yaml` (anglais, voir D2) ;
**FR** `:91` include non résolus, `:156` job sans script.

`packages/adapter-gitlab/src/resolve.ts` — **FR** `:130` cycle d'extends, `:141` cible d'extends
absente. `:162` dédoublonne **par `code` + `message`**, ce qui doit changer (D5).

`packages/adapter-gitlab/src/apply.ts` — 44 appels à `fail()`, tous **FR**. Les deux codes
fourre-tout, à l'origine de la décision D1 :

- `INVALID_OPERATION`, 8 textes distincts : `:121` job en flow style, `:203` job sans script,
  `:531` environnement hérité non retirable, `:772` pas de map YAML à la racine, `:791` YAML
  invalide produit, plus `core/src/operations.ts:181` et `:201`, plus les trois d'enveloppe du
  serveur.
- `RANGE_OUT_OF_BOUNDS`, 9 textes distincts : `:261` et `:316` plage d'un job, `:343` clé `stage`,
  `:401/413/473` clé `needs`, `:406/428` dernier need, `:525/545` clé `environment`,
  `:607/613/621/677/690` liste de stages, `:632/699` liste de stages vide, `:586` et `:655` index
  hors liste, `:708` plage hors texte.

`packages/adapter-gitlab/src/emit.ts:24` — **FR**, `throw new Error` interne.

`packages/server/src/app.ts` — **FR** `:63, 77, 84, 93, 103, 109, 117, 133, 139, 143, 159, 166,
174, 179, 184`. `packages/server/src/store.ts` — **FR** `:162, 180`.
`packages/server/src/index.ts:58` — **FR** « erreur interne ».

`packages/cli/src/validate.ts` — **FR** `:21` préfixe d'usage, `:35` fichier en trop, `:41` format
inconnu, `:82` « aucun diagnostic », `:101` pas un fichier, `:105` fichier introuvable. Plus `:73`,
qui normalise `diagnostic.message` et devra normaliser le rendu.

`packages/cli/src/start.ts` — **FR** `:51, 72, 81, 83, 90, 106, 107`.
`packages/cli/src/run.ts` — **FR** `:19-22` descriptions, `:29-36` texte d'aide, `:74` commande non
implémentée, `:81` commande inconnue.

`packages/ui/src/main.tsx:8` — **FR**, `throw new Error` interne.

### 3. Forme actuelle et forme cible des erreurs de l'API

Actuelle, `ErrorBody` (`server/src/store.ts:34`) et le `fail()` d'`app.ts:29` :

```ts
{ code: string; message: string; details?: unknown; hash?: string }
```

Cible :

```ts
{ code: MessageCode; params: ParamsOf<MessageCode>; hash?: string }
```

`message` disparaît du fil. `ApiFailure` (`ui/src/api/client.ts:26`) suit : `params` remplace
`details`, et `message` n'est plus reçu mais **calculé** par `render()`. Son repli actuel
« unexpected server response » devient le code `UNEXPECTED_RESPONSE`, et `NETWORK_ERROR` —
aujourd'hui inventé côté client avec le texte de l'exception — devient un code avec
`params.detail`. Les deux sont des codes du client, pas du serveur ; ils entrent au registre pour
que le test d'exhaustivité ne les laisse pas dehors.

## Décisions prises au cadrage

Toutes réversibles, donc tranchées ici sans ADR. L'ADR 0002 reçoit en fin de lot la seule ligne
qu'il lui manque, sur sa portée.

**D1 — un discriminant `reason` dans les `params`, pas de nouveau code.** `INVALID_OPERATION` et
`RANGE_OUT_OF_BOUNDS` couvrent chacun plusieurs situations distinctes (8 et 9 textes). Un code par
situation serait plus net, mais les codes sont un contrat public et en ajouter treize dépasse le
périmètre. `ParamsOf<C>` est donc une **union discriminée** sur `reason` pour ces deux codes, et le
rendu branche dessus. Le discriminant est documenté : il fait partie du contrat au même titre que
le code.

**D2 — le texte de bibliothèque passe en `params`, il n'est pas réécrit.** `INVALID_YAML` porte
`{ detail }`, la phrase de la lib `yaml` ; `INVALID_OPERATION` avec `reason: "schema"` porte
`{ path, detail }`, celle de zod. Les deux sont déjà en anglais. Le module les **encadre** sans les
rédiger : réécrire les erreurs de parsing YAML à la main serait perdre de la précision pour gagner
une uniformité de façade.

**D3 — la chrome de la CLI reste dans la CLI, en anglais.** Usage, aide, descriptions de commandes,
« no diagnostics » : ces textes ne portent aucun code et ne sont consommés par personne d'autre. Les
mettre au registre obligerait à inventer des codes pour des lignes d'aide. Ils sont traduits sur
place. La règle « aucune chaîne hors du module » vaut pour tout ce qui **porte un code**.

**D4 — les six codes de transport du serveur entrent au registre.** Sinon l'UI ne peut pas les
rendre, et le test « tout code a un message » aurait son trou exactement là où était le français.
Ils deviennent des constantes exportées et `specs/diagnostics.md` gagne une troisième table.

**D5 — le dédoublonnage de `resolve.ts` porte sur `code` + `params`.** Il comparait `code` +
`message`. Avec des `params`, la comparaison se fait sur une sérialisation stable à clés triées.
Sans cela, deux cibles d'`extends` absentes différentes se confondraient, ou pire, deux diagnostics
identiques apparaîtraient deux fois.

**D6 — `params` est toujours présent.** `Diagnostic` devient
`{ code, severity, range, params }`, `OperationError` devient `{ code, params }`. Pas d'optionnel :
un champ absent la moitié du temps se lit comme une donnée facultative, alors que `params` est le
contrat. Les codes sans donnée portent `Record<string, never>`.

**D7 — le test du module vit dans `packages/core/test/`, pas dans `src/`.** L'arborescence demandée
le place dans `src/messages/`, ce que la **contrainte de runtime Node** de `CLAUDE.md` interdit : le
`tsconfig.json` de `core` n'inclut que `src/` avec `"types": ["node"]`, donc `bun:test` n'y
compile pas, et `scripts/check-runtime.ts` échoue sur tout import `bun:*` dans un `src/` de package
runtime. Le fichier va donc en `packages/core/test/messages.test.ts`, avec les autres tests de
`core`. C'est la seule divergence avec l'arborescence demandée.

## Arborescence cible

```
packages/core/src/messages/
  codes.ts     MessageCode + ParamsOf<C>, union discriminée là où D1 l'exige
  en.ts        Record<MessageCode, (p) => string>, exhaustivité garantie à la compilation
  index.ts     render(code, params) — exporté comme @keelson/core/messages
packages/core/test/messages.test.ts    (D7)
```

`packages/core/package.json` gagne l'export `"./messages"`, `tsconfig.base.json` le chemin
`@keelson/core/messages`.

## Plan de tests

1. **Exhaustivité, dans les deux sens** (`core/test/messages.test.ts`) : l'ensemble des clés de
   `en.ts`, celui de `MESSAGE_CODES` et celui des codes listés dans `specs/diagnostics.md` sont
   **égaux**. Trois comparaisons, pas une inclusion. Un code ajouté sans message, un message sans
   code, un code non documenté : trois échecs distincts, avec le nom du code dans le message
   d'échec.
2. **Chaque rendu est exercé** avec des `params` représentatifs : aucune sortie ne contient
   `undefined`, `null`, `[object Object]`, un reste de gabarit (`${`, `{{`), ni un caractère
   français (`éèêàçùûôîâœ«»`). Les unions discriminées sont couvertes **branche par branche** : le
   test énumère les `reason` et échoue si l'un n'est pas exercé.
3. **`core` et adaptateurs** : les tests existants qui asservissent `message` passent à `code` +
   `params`. Un test vérifie qu'aucun diagnostic ni erreur rendu par `parse`, `validate` et `apply`
   ne porte de clé `message` ni `details`. Le dédoublonnage de D5 est testé sur deux cibles
   d'`extends` absentes différentes dans un même fichier.
4. **CLI** : `keelson validate` rend le texte anglais de `render()` pour chaque famille de
   diagnostic ; `--format json` expose `code`, `params` **et** `message` rendu — le JSON est
   consommé par des scripts, qui ont besoin des deux.
5. **Serveur** : pour **chaque chemin d'erreur** — les six de transport, les trois d'enveloppe, le
   relais de `parseOperation`, le relais d'`apply`, le 409 avec `hash` — un test vérifie la forme
   exacte du corps et **l'absence de clé `message`**. Le double calcul de hash est couvert par un
   test qui compte les appels à `hashText` sur une requête.
6. **UI** : `ErrorBanner` est testé **sur le DOM rendu** avec `JOB_REFERENCED` — la phrase anglaise
   rendue par `render()` et chacun des référents doivent être visibles. Idem pour un code sans
   `params`. `referencedBy()` lit `params.referencedBy`.
7. **E2E sur le binaire réel** : un 409… — en fait un **422** `JOB_REFERENCED`, le 409 étant réservé
   à `STALE_DOCUMENT` (`store.ts:189`) ; l'énoncé du lot dit « un 409 `JOB_REFERENCED` », ce que le
   serveur ne peut pas produire. Le test force donc le vrai chemin : supprimer un job dont un autre
   a besoin, et vérifier que la bannière affiche la phrase anglaise et les référents.

Chaque correctif et chaque invariant est **vérifié rouge en réintroduisant le défaut réel**, sans
`git stash` : le fichier est restauré par réécriture et `git diff` vérifié vide.

## Définition de terminé

- `bun install --frozen-lockfile`, puis `bun run check` depuis un arbre **sans aucun `dist/`**, puis
  `bun run e2e`, puis le binaire buildé exécuté sous `node`.
- Aucun message français dans `packages/*/src` hors commentaires, vérifié par `grep`.
- `specs/diagnostics.md` documente les `params` de chaque code, transport du serveur compris.
- `specs/gaps.md` à jour : écarts traités clos avec leur preuve, nouveaux écarts ajoutés.
- L'ADR 0002 porte sa ligne de portée complétée, et l'écart du 2026-10-22 qui la motivait est clos.
- Journal dans `specs/progress.md`, merge `--no-ff` dans `main`, `bun run check` vert sur `main`.
