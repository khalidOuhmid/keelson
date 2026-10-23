# Lot L2b — résolution des `include` locaux

Cadrage écrit avant toute ligne de code, depuis le code réel de `main` à `c1c15e4`.

Le lot ferme l'écart du 2026-10-20 « les `include` ne sont pas résolus » et les deux écarts du
2026-10-22 qui en dépendent : l'indicateur de pipeline partiel, et la sévérité d'
`EXTENDS_TARGET_NOT_FOUND`.

## 1. Sémantique GitLab, vérifiée sur la documentation officielle

Source : <https://docs.gitlab.com/ci/yaml/includes/> et <https://docs.gitlab.com/ci/yaml/#includelocal>,
consultées le 2026-10-23. Citations entre guillemets.

| Point | Ce que dit GitLab | Conséquence pour Keelson |
| --- | --- | --- |
| Forme du chemin | « a full path relative to the root directory (`/`) » ; « The YAML file must have the extension `.yml` or `.yaml` » | Le chemin est résolu depuis la racine du dépôt, **jamais** relativement au fichier qui l'inclut. Le `/` de tête est optionnel et retiré à la normalisation. Toute autre extension est refusée. |
| Branche | « The `.gitlab-ci.yml` file and the local file must be on the same branch » | Keelson lit l'arbre de travail : la contrainte est satisfaite par construction. |
| Jokers | « You can use `*` and `**` wildcards in the file path » | `*` ne traverse pas un `/`, `**` le traverse. `configs/*.yml` ne prend pas les sous-dossiers, `configs/**.yml` les prend, `configs/**/*.yml` ne prend **que** les sous-dossiers. |
| Sous-modules | « You can't include local files through Git submodules paths » | Hors périmètre : Keelson ne lit pas les sous-modules. |
| Ordre de fusion | « After all configuration added with `include` is merged together, the main configuration is merged with the included configuration. » | Les includes d'abord, dans leur ordre d'écriture, **puis** le fichier principal par-dessus. Le fichier principal gagne. |
| Entre includes | « the last included file takes precedence when merging the configuration from the included files » | Dernier inclus gagne. |
| Doublons | « The last time the configuration is included overrides any previous times the file was included. » | Un même fichier inclus deux fois n'est **pas** dédoublonné : il entre deux fois dans l'ordre de fusion. |
| Fusion des clés | fusion profonde des maps ; « arrays cannot be merged » | Une liste écrase, une map fusionne. C'est exactement ce que fait déjà la chaîne de `sources` d'`extends`. |
| Surcharge | « you can override the included configuration values to adapt them to your pipeline requirements » | Un job venu d'un include et redéfini partiellement dans le fichier principal est un seul job, fusionné. |
| Limite | « The maximum number of nested included files for a pipeline is 150. » | Un **compte total**, pas une profondeur de nid. |
| Contexte | « `include` configuration is always evaluated based on the location of the file containing the `include` keyword, not the project running the pipeline. » | Sans effet ici : un seul dépôt, une seule racine. |

### Divergence assumée sur la « profondeur maximale »

L'énoncé du lot demande « détection de cycle et profondeur maximale documentées, chacune avec son
code de diagnostic ». GitLab ne documente **aucune** limite de profondeur de nid : il documente une
limite de **compte total** de 150 fichiers inclus. Inventer une profondeur maximale rendrait Keelson
plus strict que sa cible, ce qui est exactement le défaut déjà consigné en écart pour
`MAX_EXTENDS_DEPTH`. Le lot livre donc :

- `INCLUDE_CYCLE` — un fichier s'inclut lui-même, directement ou non ; c'est ce qui borne
  réellement la récursion ;
- `INCLUDE_LIMIT_EXCEEDED` — le compte total de 150 est atteint, avec la limite dans les `params`.

Deux codes, chacun pour une borne réelle. La borne de profondeur n'est pas implémentée parce
qu'elle n'existe pas chez la cible.

## 2. Inventaire de l'existant

### Ce qui parle d'`include` aujourd'hui

| Emplacement | Ce qui s'y passe |
| --- | --- |
| `packages/adapter-gitlab/src/parse.ts:86-94` | `localPair(root, "include")` ; si la clé existe, un seul `INCLUDE_UNRESOLVED` en `info`, `params: {}`, sans regarder la forme ni le contenu. |
| `packages/adapter-gitlab/src/parse.ts:132` | `extendsSeverity: includePair === undefined ? "error" : "warning"` — la dégradation à compenser. |
| `packages/adapter-gitlab/src/parse.ts:114` | `isReservedTopLevel("include")` ⇒ la clé `include` devient un `OpaqueBlock` de premier niveau. |
| `packages/adapter-gitlab/src/defaults.ts:11` | `include` est dans `RESERVED_TOP_LEVEL`, donc un nom de job interdit. |
| `packages/core/src/operations.ts:39` | idem dans `RESERVED_JOB_NAMES`. |
| `specs/diagnostics.md:39` | `INCLUDE_UNRESOLVED`, `info`, `params: {}`. |
| `packages/core/src/messages/en.ts:21` | « includes are not resolved: the pipeline shown contains only this local file ». |
| `packages/adapter-gitlab/test/corpus/edge-cases/with-include.gitlab-ci.yml` | la seule fixture d'`include`, un fichier seul. |

### Surfaces que le lot touche

| Surface | Fichier | Changement |
| --- | --- | --- |
| `Diagnostic` | `packages/core/src/diagnostics.ts` | gagne `file: string` : avec plusieurs fichiers, une plage sans fichier ne situe plus rien. |
| `Job`, `Template`, `Stage` | `packages/core/src/ir.ts` | gagnent `file: string`. |
| `Pipeline` | `packages/core/src/ir.ts` | gagne `main`, `files`, `unresolved`. |
| `Origin` | `packages/core/src/ir.ts` | gagne `{ kind: "include"; file: string }`. |
| `parse` | `packages/adapter-gitlab/src/parse.ts` | `parse(text, options?)` avec `file` et `read`. |
| `GitlabDocument` | `packages/adapter-gitlab/src/document.ts` | porte le contexte d'include dont `apply` a besoin. |
| `apply` | `packages/adapter-gitlab/src/apply.ts` | refuse toute opération visant un élément d'un fichier inclus. |
| CLI | `packages/cli/src/validate.ts` | lecteur sur disque, et `file` du diagnostic dans `fichier:ligne:colonne`. |
| Serveur | `store.ts`, `watcher.ts`, `workspace.ts` | lecteur, surveillance des fichiers inclus, liste blanche d'écriture inchangée. |
| UI | `api/client.ts`, `views/`, `panels/`, `editing/` | origine affichée, édition coupée, indicateur de pipeline partiel. |

### Les dix sites qui produisent un diagnostic

`resolve.ts:129` et `:140` ; `parse.ts:76`, `:90`, `:154` ; `validate.ts:151`, `:170`, `:181`,
`:193`. Chacun doit désormais nommer son fichier. `validate()` le tire du job concerné, qui le
porte.

## 3. Décisions de cadrage

Toutes réversibles sauf D1 et D3, qui partent en ADR.

**D1 — le lecteur est synchrone, et c'est une décision d'architecture.** `parse` est synchrone et
`apply` appelle `parse` pour obtenir le CST. Rendre `parse` asynchrone contaminerait `apply`, donc
toute la chaîne d'édition, pour un gain nul : les fichiers inclus sont peu nombreux et déjà dans le
cache du système de fichiers. Le lecteur est donc une interface synchrone injectée. **ADR 0005.**

**D2 — l'interface du lecteur ne fait pas de glob.** Elle expose `read(path)` et `candidates()`. La
traduction d'un motif `*`/`**` en correspondance est **dans l'adaptateur**, donc testable sur un
objet littéral, sans disque. `candidates()` n'est appelé que si un motif contient un joker.

**D3 — la résolution produit une chaîne de maps par clé, pas un document fusionné.** Keelson ne
fabrique jamais un YAML fusionné : chaque fichier garde son CST et ses offsets, et la fusion est
une liste ordonnée de `Source` — exactement le mécanisme qui résout déjà `extends` et les anchors.
Conséquence : les plages restent vraies dans leur fichier, et l'écriture en place reste possible.
**ADR 0006.**

**D4 — le propriétaire d'un job est son *dernier* contributeur.** Un job défini dans un include et
redéfini dans le fichier principal appartient au fichier principal, donc reste éditable. C'est la
conséquence directe de l'ordre de fusion de GitLab, et c'est aussi le fichier qu'un utilisateur
éditerait à la main.

**D5 — `Diagnostic.file` est toujours présent.** Pas d'`undefined` signifiant « le fichier
principal » : c'est précisément le genre de valeur absente que le lot L2c a passé sa journée à
retirer des rendus.

**D6 — `parse(text)` sans options reste légal**, avec `file` par défaut à `.gitlab-ci.yml` et aucun
lecteur. Sans lecteur, aucun include n'est résolu et le comportement est celui d'aujourd'hui, à
ceci près que la forme de chaque include est désormais nommée.

**D7 — `INCLUDE_UNRESOLVED` change la forme de ses `params`**, de `{}` à `{ form, detail }`. C'est
une rupture de contrat au sens de `specs/diagnostics.md`, assumée : le code existe depuis L1, aucun
client externe ne consomme encore l'API, et un indicateur de pipeline partiel qui ne sait pas dire
*quoi* manque ne vaut rien. Le `form` reprend le vocabulaire de GitLab : `remote`, `project`,
`template`, `component`.

**D8 — l'ordre des fichiers d'un joker est lexicographique.** GitLab ne le documente pas. Le
déterminisme est une propriété testée du projet, et l'ordre de fusion décide quelle valeur gagne :
un ordre non spécifié est un résultat non spécifié.

**D9 — la sévérité d'`EXTENDS_TARGET_NOT_FOUND` suit les *includes non résolus*, pas la présence
d'une clé `include`.** Aujourd'hui elle est dégradée dès qu'une clé `include` existe. Après ce lot,
elle reste `error` si tous les includes sont résolus — même s'il y en a — et ne tombe en `warning`
que si au moins un include non résolu peut expliquer l'absence.

## 4. Codes de diagnostic et d'erreur ajoutés

| Code | Famille | Sévérité / statut | `params` |
| --- | --- | --- | --- |
| `INCLUDE_UNRESOLVED` *(forme changée)* | diagnostic | info | `{ form: "remote" \| "project" \| "template" \| "component"; detail: string }` |
| `INCLUDE_NOT_FOUND` | diagnostic | error | union sur `reason` : `missing { path }` · `notYaml { path }` · `outsideRoot { path }` · `malformed` |
| `INCLUDE_CYCLE` | diagnostic | error | `{ trail: readonly string[] }` |
| `INCLUDE_LIMIT_EXCEEDED` | diagnostic | error | `{ limit: number }` |
| `FROM_INCLUDED_FILE` | erreur d'opération | 422 | union sur `reason` : `job { job, file }` · `stages { file }` · `referencedByInclude { job, file, referencedBy }` |

`outsideRoot` est une mesure de sécurité, pas une conformité : un `include: local: ../../etc/passwd`
doit être refusé avant toute lecture, parce que le serveur de Keelson lit le disque pour le compte
d'une page web.

## 5. Arborescence cible

```
packages/core/src/
  ir.ts                      Job.file, Template.file, Stage.file, Pipeline.main/files/unresolved,
                             Origin { kind: "include" }, isPartial()
  diagnostics.ts             Diagnostic.file
  messages/codes.ts          les quatre nouveaux codes + FROM_INCLUDED_FILE
  messages/en.ts             leurs phrases, branches comprises
  validate.ts                attribue le fichier du job à chaque diagnostic

packages/adapter-gitlab/src/
  includes.ts                NOUVEAU — IncludeReader, normalisation, motifs, graphe, cycle, limite
  parse.ts                   parse(text, options), lookup multi-fichiers, file sur chaque élément
  resolve.ts                 chaîne de sources inter-fichiers
  document.ts                contexte d'include porté par le document
  apply.ts                   refus FROM_INCLUDED_FILE

packages/cli/src/
  reader.ts                  NOUVEAU — IncludeReader sur node:fs, mémoïsé
  validate.ts                file du diagnostic dans fichier:ligne:colonne

packages/server/src/
  reader.ts                  NOUVEAU — même lecteur, borné à la racine du workspace
  store.ts                   parse avec lecteur, expose les fichiers inclus
  watcher.ts                 surveille aussi les dossiers des fichiers inclus
  app.ts                     route de lecture d'un fichier inclus

packages/ui/src/
  (à cadrer par /impeccable shape) badge d'origine, édition coupée, indicateur partiel
```

## 6. API

### `IncludeReader`

```ts
export type IncludeReader = {
  /** `path` normalisé : relatif à la racine, séparateurs `/`, sans `/` de tête.
   *  `null` si le fichier n'existe pas ou n'est pas lisible. */
  read(path: string): string | null;
  /** Tous les fichiers `.yml`/`.yaml` du dépôt, normalisés. Appelé seulement pour un motif. */
  candidates(): readonly string[];
};
```

### `parse`

```ts
export type ParseOptions = {
  /** Chemin du fichier principal, relatif à la racine. Défaut : `.gitlab-ci.yml`. */
  file?: string;
  /** Absent ⇒ aucun include résolu, chacun signalé par sa forme. */
  read?: IncludeReader;
};
export function parse(text: string, options?: ParseOptions): ParseResult;
```

### Serveur

`GET /api/documents/:file` répond pour le **fichier principal** seulement. Sa charge gagne
`included: Record<chemin, texte>`, et le `pipeline` porte `main`, `files` et `unresolved`.

**Correction du 2026-10-23 : la route `GET /api/includes/:file` annoncée ici n'a pas été écrite**, et
ne doit pas l'être. Les textes des fichiers inclus voyagent dans la charge du document. Trois
raisons : les plages des blocs opaques sont des offsets dans ces textes, et une route séparée les
laisserait se désaligner entre deux requêtes ; une seconde surface de lecture du disque serait une
seconde frontière à borner ; et le client ne peut pas demander un fichier hors de la résolution,
puisqu'il ne demande rien. La liste blanche **d'écriture** reste le seul fichier principal.

## 7. Arborescence des tests

```
packages/adapter-gitlab/test/
  includes.test.ts              normalisation, motifs, cycle, limite, ordre de fusion
  includes.golden.test.ts       IR golden de chaque arbre du corpus
  corpus/includes/
    simple/                     .gitlab-ci.yml + ci/jobs.yml
    nested/                     include qui inclut un include
    mixed-list/                 local + chaîne relative + distant dans une seule liste
    override/                   job inclus redéfini partiellement dans le principal
    wildcard/                   configs/*.yml, trois fichiers, ordre lexicographique
    cycle/                      a inclut b, b inclut a
    missing/                    include vers un fichier absent
    extends-across/             extends dont la cible est dans un fichier inclus
    reference-across/           !reference dont la cible est dans un fichier inclus
    stages-from-include/        stages déclarés uniquement dans l'include
    remote-only/                include distant seul, pipeline partiel
  corpus/goldens/includes/      un golden par arbre
  operations/includes.test.ts   chaque opération refusée sur un élément inclus
  properties/                   les quatre propriétés étendues aux arbres

packages/core/test/
  messages.test.ts              exhaustivité, branches des nouveaux reasons
  validate.test.ts              le fichier attribué à chaque diagnostic

packages/cli/test/validate.test.ts     fichier:ligne:colonne du bon fichier
packages/server/test/includes.test.ts  lecteur borné, watcher, route de lecture
packages/ui/test/                      origine affichée, édition coupée, indicateur partiel
packages/ui/e2e/includes.e2e.ts        sur le binaire réel, arbre multi-fichiers
```

### Règles de test du lot

- Chaque test d'invariant est **prouvé rouge** en réintroduisant le défaut réel, puis le fichier est
  restauré par réécriture et `git diff` vérifié vide. Jamais `git stash`.
- **Aucun `try/catch` ni repli** dans le code de production ne doit pouvoir absorber l'échec du test
  qui le surveille. C'est le constat n° 1 du lot L2c : un filet ajouté dans `render()` avait rendu
  inerte le test de couverture du même lot. Tout test de couverture de branches appelle donc la
  table directement, sans passer par le point d'entrée qui replie.
- La propriété de **localité** gagne une clause : aucune opération ne modifie jamais le contenu d'un
  fichier inclus. Vérifiée sur les octets des fichiers, pas sur l'intention de l'opération.
- Un champ calculé sans effet à l'écran est soit branché, soit supprimé.

## 8. Définition de terminé

1. `bun install --frozen-lockfile` sans changement.
2. `bun run check` vert depuis un arbre sans aucun `dist/`, `types/` ni `*.tsbuildinfo`.
3. `bun run e2e` vert sur le binaire buildé.
4. Le binaire buildé exécuté sous `node` résout un arbre multi-fichiers et nomme le bon fichier.
5. `grep` ne trouve aucun message français dans `packages/*/src` hors commentaires et tests.
6. `/impeccable shape` avant les surfaces d'UI, puis `critique`, `audit`, `polish` ; `document` si
   les tokens changent.
7. Revue indépendante en lecture seule dans un worktree isolé, triage par l'ADR 0003.
8. Les trois écarts du périmètre clos avec leur preuve ; tout nouveau constat consigné.
9. Journal dans `specs/progress.md` : commits, comptes de tests, ADR, dettes, écarts, divergences,
   et chaque test trouvé incapable d'échouer avec sa cause.
10. `git merge --no-ff` dans `main`, puis `bun run check` vert sur `main`. Lot suivant : L3.
