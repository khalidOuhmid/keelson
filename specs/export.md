# Formats d'export

`keelson export [fichier] [--format markdown|mermaid|json]` écrit sur la sortie standard. Le format
par défaut est `markdown`. Mêmes entrées, mêmes octets. Code 2 sur un usage invalide, 0 sinon : un
pipeline qui porte des erreurs s'exporte quand même, et `--format json` les donne.

## `markdown`

Un rapport de couverture : titre `# Coverage report`, compte des couches OWASP et des catégories
plateforme, phrase de borne basse si le pipeline est partiel, puis une table à quatre colonnes
(`Layer`, `Covered`, `Jobs`, `Services`), une ligne par couche, dans l'ordre de la taxonomie. Un `|`
ou un `\` d'un nom est échappé.

## `mermaid`

Un `flowchart LR` :

| Élément | Forme |
| --- | --- |
| stage non vide | `subgraph sN["nom"]` |
| job | `jN["nom"]` |
| service | `vN[("nom")]` |
| dépendance | `jA --> jB`, en `-.->` si elle est optionnelle |
| intégration | `jA -->\|type\| vB` |

Les identifiants sont des positions, les noms ne passent que par des libellés entre guillemets, où
`"` s'écrit `#quot;`. Une dépendance ou une intégration vers un élément absent n'est pas dessinée.

## `json`

`{ pipeline, coverage, toolchain, diagnostics }` : l'IR, la couverture, la toolchain, et les
diagnostics que rend `keelson validate`. `pipeline` suit `packages/core/src/ir.ts`, sans garantie de
compatibilité avant la première version publiée.
