# Export formats

`keelson export [file] [--format markdown|mermaid|json]` writes to standard output. The default
format is `markdown`. Same inputs, same bytes. Exit code 2 on invalid usage, 0 otherwise: a pipeline
that carries errors is still exported, and `--format json` reports them.

## `markdown`

A coverage report: a `# Coverage report` title, the count of OWASP layers and platform categories,
a lower-bound sentence if the pipeline is partial, then a four-column table (`Layer`, `Covered`,
`Jobs`, `Services`), one row per layer, in taxonomy order. `Services` also names the CI that proves
source control (`ci gitlab-ci`, `ci github-actions`). A `|` or a `\` in a name is escaped.

## `mermaid`

A `flowchart LR`:

| Element | Shape |
| --- | --- |
| non-empty stage | `subgraph sN["name"]` |
| job | `jN["name"]` |
| service | `vN[("name")]` |
| dependency | `jA --> jB`, as `-.->` if it is optional |
| integration | `jA -->\|type\| vB` |

Identifiers are positions; names only go through quoted labels, where `#`, `"` and `%` are written
`#35;`, `#quot;` and `#37;`, and where a line break becomes a space. A job whose stage is not
declared still gets its `subgraph`. A dependency or an integration pointing to a missing element is
not drawn.

## `json`

`{ pipeline, coverage, toolchain, diagnostics }`: the IR, the coverage, the toolchain, and the
diagnostics returned by `keelson validate`. `pipeline` follows `packages/core/src/ir.ts`, with no
compatibility guarantee before the first published version.
