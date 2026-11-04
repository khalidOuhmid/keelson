# Diagnostics et codes d'erreur

Les codes de ce document sont des **contrats publics**. Chacun est exporté comme constante depuis
`@keelson/core/messages`, couvert par au moins un test, et consommé par
`keelson validate --format json`. Renommer ou supprimer un code est une rupture de compatibilité.

**La forme des `params` est un contrat au même titre que le code** ([ADR
0002](adr/0002-langue-et-messages.md)) : en changer la forme est une rupture de compatibilité.
`core`, les adaptateurs et `@keelson/server` ne produisent **jamais de texte** ; ils rendent
`code` + `params`. Le seul endroit du produit qui transforme un `(code, params)` en phrase est
`render()` dans `@keelson/core/messages`, utilisé par la CLI **et** par l'UI.

Un test échoue si un code de ce document n'a pas de message, si un message n'a pas de code, ou si
l'ensemble des codes documentés ici diffère de celui du registre — **dans les deux sens**
(`packages/core/test/messages.test.ts`).

**Chaque diagnostic porte un `file`**, chemin relatif à la racine du dépôt, et son `range` est un
offset dans le texte de **ce** fichier. Depuis la résolution des `include` (lot L2b), un pipeline
est fait de plusieurs fichiers : une plage sans fichier ne situe plus rien.

Trois familles distinctes, plus les codes forgés par le client :

- les **diagnostics** (`Diagnostic`) décrivent l'état d'un fichier analysé ; ils sont rendus par
  `parse` et `validate`, portent une sévérité et une plage, et n'empêchent rien ;
- les **erreurs d'opération** (`OperationError`) sont rendues par `apply` quand une édition est
  refusée ; elles n'ont pas de sévérité et **aucune modification n'est écrite** ;
- les **codes de transport** sont rendus par `@keelson/server` avant ou autour du traitement d'une
  requête.

## Le discriminant `reason`

Plusieurs codes couvrent chacun plusieurs situations distinctes.
Plutôt que d'ajouter treize codes à un contrat public, leurs `params` portent un discriminant
**`reason`**, et le rendu branche dessus. Le `reason` fait donc partie du contrat : les valeurs
possibles sont listées ci-dessous, et l'exhaustivité des branches de rendu est garantie à la
compilation.

## Diagnostics

| Code | Sévérité | Produit par | `params` | Signification |
| --- | --- | --- | --- | --- |
| `INVALID_YAML` | error | `parse` | `{ detail }` | Le fichier n'est pas du YAML valide. Un diagnostic par erreur rendue par la lib `yaml`, avec la position. `detail` est la phrase de la lib, reprise telle quelle : elle est déjà en anglais et plus précise que toute reformulation. Le parsing continue : le pipeline rendu est partiel. |
| `INCLUDE_UNRESOLVED` | info | `parse` | `{ form, detail }` | Un `include` d'une forme que Keelson ne résout pas : `remote`, `project`, `template` ou `component`. Un diagnostic par entrée, et non un seul par fichier. `detail` est la valeur telle qu'elle est écrite. Le pipeline affiché est **partiel** : voir `Pipeline.unresolved` et `isPartial()`, qui comptent aussi les `include` locaux cassés, signalés eux par `INCLUDE_NOT_FOUND`. |
| `INCLUDE_NOT_FOUND` | error | `parse` | union sur `reason` : `missing {path}` · `notYaml {path}` · `outsideRoot {path}` · `malformed` | Un `include: local` ne mène à rien d'utilisable. `missing` : le fichier n'existe pas. `notYaml` : GitLab exige l'extension `.yml` ou `.yaml`. `outsideRoot` : le chemin sort de la racine du dépôt — refusé **avant** toute lecture, parce que le serveur lit le disque pour le compte d'une page web. `malformed` : l'entrée n'a aucune forme reconnaissable. |
| `INCLUDE_CYCLE` | error | `parse` | `{ trail }` | Une chaîne d'`include` boucle. `trail` est le chemin du cycle, premier élément répété en dernier. La résolution s'arrête à la boucle, le parsing aboutit. |
| `INCLUDE_LIMIT_EXCEEDED` | error | `parse` | `{ limit }` | Plus de `limit` fichiers inclus. Le pipeline est alors partiel : la première entrée coupée est dans `Pipeline.unresolved`. La limite documentée par GitLab est de **150** fichiers inclus par pipeline, nids compris — c'est un compte, pas une profondeur de nid, et Keelson n'en invente pas d'autre. |
| `EXTENDS_TARGET_NOT_FOUND` | error, ou warning | `parse` | `{ template }` | Un `extends` pointe vers une clé absente de **tous** les fichiers résolus. Dégradé en **warning** seulement si un `include` qu'on n'a pas pu lire peut expliquer l'absence : une forme distante, ou un `local` quand l'appelant n'a fourni aucun lecteur. Un `include` local **cassé** ne dégrade rien : sa cause est déjà un `INCLUDE_NOT_FOUND` en erreur ([ADR 0007](adr/0007-ce-qui-degrade-une-cible-extends-absente.md)). Signalé une seule fois par cible. |
| `EXTENDS_CYCLE` | error | `parse` | `{ trail }` | Une chaîne d'`extends` boucle. `trail` est le chemin du cycle, premier élément répété en dernier. La résolution s'arrête à la boucle, le parsing aboutit. |
| `JOB_WITHOUT_SCRIPT` | warning | `parse` | `{ job }` | Un job n'a ni `script`, ni `run`, ni `trigger`. Évalué **après** résolution des `extends` et des anchors. |
| `UNKNOWN_NEED` | error | `validate` | `{ job, need }` | Un `needs` pointe vers un job qui n'existe pas. Un template (clé commençant par `.`) n'est pas un job valide pour un `needs`. |
| `NEEDS_CYCLE` | error | `validate` | `{ cycle }` | Les `needs` forment un cycle. Un diagnostic par composante fortement connexe ; `cycle` est le chemin, premier élément répété en dernier. |
| `UNKNOWN_STAGE` | error | `validate` | `{ job, stage }` | Un job référence un stage non déclaré. |
| `NEED_LATER_STAGE` | warning | `validate` | `{ job, stage, need, needStage }` | Un job a besoin d'un job situé dans un stage ultérieur. Non évalué quand le stage du job est lui-même inconnu. |
| `LAYOUT_INVALID` | warning | `parseLayout` | `{ detail }` | `.devsecops/layout.json` n'est pas du JSON valide ou ne suit pas son schéma. Il est alors ignoré : la détection s'applique. |
| `LAYOUT_UNKNOWN_LAYER` | warning | `parseLayout` | `{ job, layer }` | Une surcharge nomme une couche absente de la taxonomie. Cette couche est ignorée, les autres s'appliquent. |
| `LAYOUT_UNKNOWN_JOB` | warning | `parseLayout` | `{ job }` | Une surcharge nomme un job absent du pipeline. |
| `COVERAGE_LAYER_MISSING` | error | `keelson coverage` | `{ layer, name }` | Une couche demandée par `--require` n'est pas couverte. |
| `CATALOG_INVALID_TOOL` | error | `catalog lint` | `{ detail }` | Une fiche ne suit pas le schéma. `detail` vient de zod ou de `yaml`. |
| `CATALOG_DUPLICATE_TOOL` | error | `catalog lint` | `{ tool }` | Deux fiches portent le même identifiant. |
| `CATALOG_UNKNOWN_LOGO` | error | `catalog lint` | `{ tool, logo }` | La fiche nomme un logo absent du catalogue embarqué. |
| `CATALOG_MISSING_SNIPPET` | error | `catalog lint` | `{ tool }` | Un outil de type `job` n'a aucun snippet. |
| `CATALOG_STALE_TOOL` | warning | `catalog lint` | `{ tool, lastVerified }` | La fiche n'a pas été vérifiée depuis plus de six mois. |
| `TOOLCHAIN_INVALID` | error | `parseToolchain` | `{ detail }` | `.devsecops/toolchain.yaml` n'est pas du YAML valide ou ne suit pas son schéma. La toolchain est alors vide, et aucune opération ne l'édite. |
| `TOOLCHAIN_UNKNOWN_TOOL` | error | `validateToolchain` | `{ service, tool }` | Un service nomme un outil absent du catalogue. |
| `TOOLCHAIN_UNKNOWN_SERVICE` | error | `validateToolchain` | `{ job, service }` | Une intégration nomme un service non déclaré. |
| `TOOLCHAIN_UNKNOWN_JOB` | error, ou warning | `validateToolchain` | `{ job }` | Une intégration nomme un job absent du pipeline. Warning sur un pipeline partiel : le job peut venir d'un include non résolu. |
| `TOOLCHAIN_DUPLICATE_INTEGRATION` | warning | `validateToolchain` | `{ job, service, kind }` | La même intégration figure deux fois. |

### Exemples

**`INVALID_YAML`**

```yaml
a:
  - x
 bad: [1,
```

```
fichier.yml:3:2 error INVALID_YAML All mapping items must start at the same column
```

**`INCLUDE_UNRESOLVED`**

```yaml
include:
  - local: ci/jobs.yml
  - template: Jobs/SAST.gitlab-ci.yml
```

Le premier est résolu, le second non : un seul diagnostic, pour le `template`.

```
fichier.yml:3:5 info INCLUDE_UNRESOLVED this template include is not resolved (Jobs/SAST.gitlab-ci.yml), so the pipeline shown may be incomplete
```

**`INCLUDE_CYCLE`**

```yaml
# .gitlab-ci.yml
include: ci/a.yml
# ci/a.yml
include: .gitlab-ci.yml
```

```
error INCLUDE_CYCLE include cycle: .gitlab-ci.yml → ci/a.yml → .gitlab-ci.yml
```

**`EXTENDS_TARGET_NOT_FOUND`**

```yaml
orphelin:
  extends: .absent
  script: echo
```

**`EXTENDS_CYCLE`**

```yaml
.a:
  extends: .b
.b:
  extends: .a
```

```
error EXTENDS_CYCLE extends cycle: .a → .b → .a
```

**`JOB_WITHOUT_SCRIPT`**

```yaml
muet:
  stage: build
```

**`UNKNOWN_NEED`**

```yaml
unit:
  needs:
    - absent
```

```
fichier.yml:1:1 error UNKNOWN_NEED job "unit" needs "absent", which does not exist
```

**`NEEDS_CYCLE`**

```yaml
a:
  needs: [c]
b:
  needs: [a]
c:
  needs: [b]
```

```
error NEEDS_CYCLE needs cycle: a → c → b → a
```

**`UNKNOWN_STAGE`**

```yaml
stages:
  - build

unit:
  stage: verify
```

**`NEED_LATER_STAGE`**

```yaml
stages:
  - build
  - deploy

compile:
  stage: build
  needs: [publish]

publish:
  stage: deploy
```

## Erreurs d'opération

Rendues par `apply` dans un `Result` en échec, et relayées telles quelles par `@keelson/server`.
Aucune n'est levée comme exception : une exception ne peut signaler qu'un bug de Keelson.

| Code | `params` | Signification |
| --- | --- | --- |
| `STALE_DOCUMENT` | `{ expected, received }` | Le `baseHash` de l'opération ne correspond pas au hash du document, qui a changé depuis le calcul de l'opération. `expected` est le hash du document, `received` celui de l'opération. Les deux sont dans les `params` pour le diagnostic, jamais dans la phrase rendue : deux empreintes de 64 caractères n'aident aucun lecteur. |
| `JOB_NOT_FOUND` | `{ job }` | Le job visé n'existe pas. Un template n'est pas un job. |
| `JOB_REFERENCED` | `{ job, referencedBy }` | `removeJob` sur un job dont d'autres jobs ont besoin. `referencedBy` liste leurs identifiants ; la suppression en cascade se compose en plusieurs opérations. C'est le seul code que l'UI traite spécialement : elle lit `params.referencedBy` pour lister les référents. |
| `NAME_CONFLICT` | `{ name }` | Le nom cible est déjà pris par une clé de premier niveau (job, template ou clé réservée). |
| `INVALID_NAME` | `{ reason: "job", name }` ou `{ reason: "stage" }` | `reason: "job"` : le nom est vide, commence par `.`, ou est un mot réservé — `stages`, `variables`, `include`, `default`, `workflow`, `image`, `services`, `cache`, `before_script`, `after_script`. `reason: "stage"` : nom de stage vide. `reason: "service"`, avec `name` : un identifiant de service suit `^[a-z0-9][a-z0-9._-]*$`. |
| `STAGE_NOT_FOUND` | `{ stage }` | Le stage visé n'est pas déclaré. Les stages implicites (`.pre`, `build`, `test`, `deploy`, `.post`) comptent comme déclarés. |
| `STAGE_EXISTS` | `{ stage }` | `addStage` sur un stage déjà présent, implicite compris. |
| `NEED_EXISTS` | `{ job, need }` | `addNeed` sur un need déjà présent dans la valeur effective. |
| `NEED_NOT_FOUND` | `{ reason: "notNeeded", job, need }` ou `{ reason: "notLocal", job, need }` | `notNeeded` : `removeNeed` sur un need absent de la valeur effective. `notLocal` : le need **est** effectif, mais la liste `needs` du job n'est pas une séquence lisible item par item — un alias d'anchor ou un `!reference` — donc le retirer demanderait de réécrire la liste partagée, ce que Keelson ne fait pas. |
| `CYCLE` | `{ operation }` | L'opération créerait un cycle dans les `needs` qui n'existait pas avant. Évalué sur l'IR du texte résultant, pour toutes les opérations sauf `splice`. |
| `UNSUPPORTED_VERSION` | `{ received, supported }` | L'opération porte un `v` numérique différent de `1`. |
| `INVALID_OPERATION` | union sur `reason`, voir ci-dessous | L'opération ne respecte pas son schéma, ou l'édition demandée n'est pas supportée. |
| `RANGE_OUT_OF_BOUNDS` | union sur `reason`, voir ci-dessous | Une plage de source est introuvable, ou un index sort de sa liste. |
| `FROM_INCLUDED_FILE` | union sur `reason`, voir ci-dessous | L'opération visait un élément qui ne vit pas dans le fichier principal. Keelson ne réécrit **jamais** un fichier inclus. |
| `SERVICE_NOT_FOUND` | `{ service }` | L'opération de toolchain vise un service non déclaré. |
| `SERVICE_REFERENCED` | `{ service, jobs }` | `removeService` sur un service encore relié à des jobs. |
| `INTEGRATION_EXISTS` | `{ job, target, kind }` | L'intégration, ou son écart, figure déjà dans le fichier. `target` est le service ou l'outil. |
| `INTEGRATION_NOT_FOUND` | `{ job, target, kind }` | L'intégration, ou son écart, ne figure pas dans le fichier. |

### `FROM_INCLUDED_FILE`

| `reason` | Autres `params` | Situation |
| --- | --- | --- |
| `job` | `job`, `file` | Le job visé vient d'un fichier inclus. Un job inclus puis **redéfini** dans le fichier principal appartient au fichier principal et reste éditable : c'est l'ordre de fusion de GitLab. |
| `nameTaken` | `name`, `file` | `addJob` ou `renameJob` vers un nom déjà pris par une clé d'un fichier inclus. Keelson refuse plutôt que d'écrire une surcharge partielle : le job résultant hériterait silencieusement des clés de l'include. |
| `stages` | `file` | La liste `stages` est déclarée dans un fichier inclus. `addStage` et `moveStage` y sont donc refusés ; ajouter un job dans un de ces stages reste permis. |
| `referencedByInclude` | `job`, `referencedBy: { job, file }[]` | `renameJob` sur un job dont un job d'un fichier inclus a besoin : renommer sans réécrire ce fichier casserait son `needs`. |

### `INVALID_OPERATION`

| `reason` | Autres `params` | Situation |
| --- | --- | --- |
| `notAnObject` | — | Le corps reçu n'est pas un objet JSON. |
| `schema` | `path`, `detail` | Le schéma zod refuse l'opération. `detail` est la phrase de zod, en anglais ; `path` la situe dans l'opération, et vaut `""` quand l'erreur porte sur la racine. |
| `flowStyleJob` | `job` | Le job est écrit en flow style (`{ … }`) ; l'édition en place supposerait un rendu par ligne. |
| `jobWithoutScript` | — | `addJob` sans aucune ligne de script. |
| `inheritedEnvironment` | `job`, `origin` | Retrait d'un environnement hérité : GitLab n'a pas de clé d'annulation. `origin` dit d'où il vient (`extends`, `anchor`, `default`). |
| `sharedValue` | `job`, `key` | La valeur vient d'un alias d'anchor ou d'un `!reference` et l'écrire en place perdrait quelque chose : `addNeed` sur une liste partagée, ou `setJobStage` sur un `!reference` portant une ancre, un commentaire ou une clé explicite `?`. |
| `flowStyleToolchain` | `section` | Une section de `toolchain.yaml` est écrite en flow style et n'est pas vide. |
| `invalidToolchain` | — | `toolchain.yaml` porte un `TOOLCHAIN_INVALID` : Keelson n'édite pas un fichier qu'il ne comprend pas. |
| `invalidLayout` | — | **Serveur** : `layout.json` n'est pas lisible. Keelson n'écrase pas ce qu'il ne comprend pas. |
| `outsideRoot` | `path` | **Serveur** : `.devsecops` mène hors du dépôt. Rien n'est écrit. |
| `noRootMap` | — | Le fichier n'a pas de map YAML à la racine, et l'opération n'est pas un `splice`. |
| `wouldBreakYaml` | `operation` | Le texte résultant serait un YAML invalide ; rien n'a été écrit. |
| `unreadableBody` | — | **Serveur** : le corps de la requête n'est pas du JSON lisible. |
| `missingOpId` | — | **Serveur** : `opId` absent ou vide. |
| `missingOp` | — | **Serveur** : `op` absent ou invalide. |

### `RANGE_OUT_OF_BOUNDS`

| `reason` | Autres `params` | Situation |
| --- | --- | --- |
| `jobRange` | `job` | Plage introuvable pour la clé du job. |
| `stageKey` | — | Plage introuvable pour la clé `stage`. |
| `needsKey` | — | Plage introuvable pour la clé `needs`. |
| `lastNeed` | — | Plage introuvable pour le dernier élément de `needs`. |
| `environmentKey` | — | Plage introuvable pour la clé `environment`. |
| `stageList` | — | Plage introuvable dans la liste de stages. |
| `emptyStageList` | — | La liste de stages est vide là où un élément est attendu. |
| `stageIndex` | `index`, `count` | Index de stage au-delà de la liste. |
| `textRange` | `start`, `end`, `length` | Un `splice` sort du texte. |

## Codes de transport

Rendus par `@keelson/server`. Toute erreur de l'API a la forme `{ code, params }`, plus `hash` pour
le 409 `STALE_DOCUMENT`. **Il n'y a pas de clé `message` sur le fil** : le texte est rendu côté
client.

| Code | Statut | `params` | Signification |
| --- | --- | --- | --- |
| `FORBIDDEN_HOST` | 403 | `{}` | L'en-tête `Host` n'est pas une forme locale attendue. Refusé avant tout traitement. |
| `FORBIDDEN_TOKEN` | 403 | `{}` | Token de session absent ou invalide sur une route `/api`. |
| `METHOD_NOT_ALLOWED` | 405 | `{ method }` | La méthode HTTP n'est pas celle de la route. |
| `NOT_FOUND` | 404 | union sur `reason` : `unreadableFileName` · `unknownFile {file}` · `missingFile {file}` · `unknownRoute {route}` · `noUiBundle` | `unknownFile` : le fichier n'est pas dans l'espace de travail. `missingFile` : il y est mais n'a pas pu être chargé. `noUiBundle` : ce serveur ne sert pas de bundle d'interface. |
| `PAYLOAD_TOO_LARGE` | 413 | `{ limitBytes }` | Corps de requête au-delà de la limite. La connexion est fermée. |
| `INTERNAL_ERROR` | 500 | `{}` | Le gestionnaire a levé. Aucun détail n'est exposé. |

## Codes forgés par le client

Aucun serveur ne les émet. Ils entrent au registre pour que le test d'exhaustivité ne laisse pas
l'UI rendre un code sans message.

| Code | `params` | Signification |
| --- | --- | --- |
| `NETWORK_ERROR` | `{ detail }` | La requête n'a pas abouti. `detail` est le message de l'exception. |
| `UNEXPECTED_RESPONSE` | `{}` | La réponse d'erreur n'a pas la forme `{ code, params }`. |

## Convention de position

`SourceRange` porte des **offsets en caractères** dans le texte source, pas des lignes. La CLI
convertit en `ligne:colonne` à l'affichage, les deux comptant **à partir de 1**.
