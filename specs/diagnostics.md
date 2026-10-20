# Diagnostics et codes d'erreur

Les codes de ce document sont des **contrats publics**. Chacun est exporté comme constante depuis
`@keelson/core`, couvert par au moins un test, et consommé par `keelson validate --format json`.
Renommer ou supprimer un code est une rupture de compatibilité.

Deux familles distinctes :

- les **diagnostics** (`Diagnostic`) décrivent l'état d'un fichier analysé ; ils sont rendus par
  `parse` et `validate`, portent une sévérité et une plage, et n'empêchent rien ;
- les **erreurs d'opération** (`OperationError`) sont rendues par `apply` quand une édition est
  refusée ; elles n'ont pas de sévérité et **aucune modification n'est écrite**.

## Diagnostics

| Code | Sévérité | Produit par | Signification |
| --- | --- | --- | --- |
| `INVALID_YAML` | error | `parse` | Le fichier n'est pas du YAML valide. Un diagnostic par erreur rendue par la lib `yaml`, avec la position. Le parsing continue : le pipeline rendu est partiel. |
| `INCLUDE_UNRESOLVED` | info | `parse` | Le fichier contient une clé `include`. Les `include` ne sont pas résolus en L1 : le pipeline affiché ne contient que ce fichier local. |
| `EXTENDS_TARGET_NOT_FOUND` | error, ou warning | `parse` | Un `extends` pointe vers une clé absente du fichier. Dégradé en **warning** quand le fichier contient des `include`, car la cible peut venir d'un include non résolu. Signalé une seule fois par cible. |
| `EXTENDS_CYCLE` | error | `parse` | Une chaîne d'`extends` boucle. Le message donne le chemin du cycle. La résolution s'arrête à la boucle, le parsing aboutit. |
| `JOB_WITHOUT_SCRIPT` | warning | `parse` | Un job n'a ni `script`, ni `run`, ni `trigger`. Évalué **après** résolution des `extends` et des anchors. |
| `UNKNOWN_NEED` | error | `validate` | Un `needs` pointe vers un job qui n'existe pas. Un templates (clé commençant par `.`) n'est pas un job valide pour un `needs`. |
| `NEEDS_CYCLE` | error | `validate` | Les `needs` forment un cycle. Un diagnostic par composante fortement connexe, avec le chemin du cycle dans le message. |
| `UNKNOWN_STAGE` | error | `validate` | Un job référence un stage non déclaré. |
| `NEED_LATER_STAGE` | warning | `validate` | Un job a besoin d'un job situé dans un stage ultérieur. Non évalué quand le stage du job est lui-même inconnu. |

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
  - template: Jobs/SAST.gitlab-ci.yml
```

```
fichier.yml:1:1 info INCLUDE_UNRESOLVED les include ne sont pas résolus : …
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
error EXTENDS_CYCLE cycle d'extends : .a → .b → .a
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
fichier.yml:1:1 error UNKNOWN_NEED le job « unit » a besoin de « absent », qui n'existe pas
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
error NEEDS_CYCLE cycle dans les needs : a → c → b → a
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

Rendues par `apply` dans un `Result` en échec. Aucune n'est levée comme exception : une exception ne
peut signaler qu'un bug de Keelson.

| Code | Signification |
| --- | --- |
| `STALE_DOCUMENT` | Le `baseHash` de l'opération ne correspond pas au hash du document. Le document a changé depuis le calcul de l'opération. `details` porte `expected` et `received`. |
| `JOB_NOT_FOUND` | Le job visé n'existe pas. Un template n'est pas un job. |
| `JOB_REFERENCED` | `removeJob` sur un job dont d'autres jobs ont besoin. `details.referencedBy` liste leurs identifiants ; la suppression en cascade se compose en plusieurs opérations. |
| `NAME_CONFLICT` | Le nom cible est déjà pris par une clé de premier niveau (job, template ou clé réservée). |
| `INVALID_NAME` | Le nom est vide, commence par `.`, ou est un mot réservé : `stages`, `variables`, `include`, `default`, `workflow`, `image`, `services`, `cache`, `before_script`, `after_script`. Vaut aussi pour un nom de stage vide. |
| `STAGE_NOT_FOUND` | Le stage visé n'est pas déclaré. Les stages implicites (`.pre`, `build`, `test`, `deploy`, `.post`) comptent comme déclarés. |
| `STAGE_EXISTS` | `addStage` sur un stage déjà présent, implicite compris. |
| `NEED_EXISTS` | `addNeed` sur un need déjà présent dans la valeur effective. |
| `NEED_NOT_FOUND` | `removeNeed` sur un need absent de la valeur effective. |
| `CYCLE` | L'opération créerait un cycle dans les `needs` qui n'existait pas avant. Évalué sur l'IR du texte résultant, pour toutes les opérations sauf `splice`. |
| `UNSUPPORTED_VERSION` | L'opération porte un `v` numérique différent de `1`. |
| `INVALID_OPERATION` | L'opération ne respecte pas son schéma zod, ou l'édition demandée n'est pas supportée : job en flow style, retrait d'un environnement hérité, `addJob` sans script, résultat qui serait un YAML invalide. |
| `RANGE_OUT_OF_BOUNDS` | Un `splice` sort du texte, ou un index de stage dépasse la liste. |

## Convention de position

`SourceRange` porte des **offsets en caractères** dans le texte source, pas des lignes. La CLI
convertit en `ligne:colonne` à l'affichage, les deux comptant **à partir de 1**.
