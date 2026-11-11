# Diagnostics and error codes

The codes in this document are **public contracts**. Each one is exported as a constant from
`@keelson/core/messages`, covered by at least one test, and consumed by
`keelson validate --format json`. Renaming or removing a code is a breaking change.

**The shape of `params` is as much a contract as the code itself** ([ADR
0002](adr/0002-language-and-messages.md)): changing it is a breaking change. `core`, the adapters
and `@keelson/server` **never produce text**; they return `code` + `params`. The only place in the
product that turns a `(code, params)` into a sentence is `render()` in `@keelson/core/messages`,
used by the CLI **and** the UI.

A test fails if a code in this document has no message, if a message has no code, or if the set of
codes documented here differs from the registry's — **in both directions**
(`packages/core/test/messages.test.ts`).

**Every diagnostic carries a `file`**, a path relative to the repository root, and its `range` is an
offset into the text of **that** file. Since `include` resolution (milestone L2b), a pipeline is made
of several files: a range without a file no longer locates anything.

Three distinct families, plus the codes forged by the client:

- **diagnostics** (`Diagnostic`) describe the state of a parsed file; they are returned by `parse`
  and `validate`, carry a severity and a range, and block nothing;
- **operation errors** (`OperationError`) are returned by `apply` when an edit is refused; they
  have no severity and **no change is written**;
- **transport codes** are returned by `@keelson/server` before or around the handling of a
  request.

## The `reason` discriminant

Several codes each cover several distinct situations. Rather than adding thirteen codes to a public
contract, their `params` carry a **`reason`** discriminant, and rendering branches on it. The
`reason` is therefore part of the contract: the possible values are listed below, and the
exhaustiveness of the rendering branches is checked at compile time.

## Diagnostics

| Code | Severity | Produced by | `params` | Meaning |
| --- | --- | --- | --- | --- |
| `INVALID_YAML` | error | `parse` | `{ detail }` | The file is not valid YAML. One diagnostic per error returned by the `yaml` library, with its position. `detail` is the library's sentence, kept verbatim: it is already in English and more precise than any rewording. Parsing continues: the returned pipeline is partial. |
| `INCLUDE_UNRESOLVED` | info | `parse` | `{ form, detail }` | An `include` of a form Keelson does not resolve: `remote`, `project`, `template` or `component`, and a `local` path carrying a CI/CD variable (`ci/$ENV.yml`), only known when the pipeline runs. One diagnostic per entry, not one per file. `detail` is the value as written. The pipeline shown is **partial**: see `Pipeline.unresolved` and `isPartial()`, which also count broken local `include`s, themselves reported by `INCLUDE_NOT_FOUND`. |
| `INCLUDE_NOT_FOUND` | error | `parse` | union on `reason`: `missing {path}` · `notYaml {path}` · `outsideRoot {path}` · `malformed` | An `include: local` leads to nothing usable. `missing`: the file does not exist. `notYaml`: GitLab requires the `.yml` or `.yaml` extension. `outsideRoot`: the path leaves the repository root — refused **before** any read, because the server reads the disk on behalf of a web page — or a symbolic link resolves outside it. `malformed`: the entry has no recognisable shape; an `include:` with no value is named `include` in `Pipeline.unresolved`. |
| `INCLUDE_CYCLE` | error | `parse` | `{ trail }` | A chain of `include`s loops. `trail` is the path of the cycle, first element repeated last. Resolution stops at the loop; parsing completes. |
| `INCLUDE_LIMIT_EXCEEDED` | error | `parse` | `{ limit }` | More than `limit` included files. The pipeline is then partial: the first entry cut off is in `Pipeline.unresolved`. GitLab's documented limit is **150** included files per pipeline, nested ones included — a count, not a nesting depth, and Keelson does not invent another. |
| `EXTENDS_TARGET_NOT_FOUND` | error, or warning | `parse` | `{ template }` | An `extends` points to a key absent from **all** resolved files. Downgraded to a **warning** only if an `include` that could not be read may explain the absence: a remote form, or a `local` one when the caller supplied no reader. A **broken** local `include` downgrades nothing: its cause is already an `INCLUDE_NOT_FOUND` error ([ADR 0007](adr/0007-what-degrades-a-missing-extends-target.md)). Reported once per target. |
| `EXTENDS_CYCLE` | error | `parse` | `{ trail }` | A chain of `extends` loops. `trail` is the path of the cycle, first element repeated last. Resolution stops at the loop; parsing completes. |
| `JOB_WITHOUT_SCRIPT` | warning | `parse` | `{ job }` | A job has no `script`, `run` or `trigger`. Evaluated **after** resolving `extends` and anchors. |
| `UNKNOWN_NEED` | error | `validate` | `{ job, need }` | A `needs` entry points to a job that does not exist. A template (a key starting with `.`) is not a valid job for `needs`. |
| `NEEDS_CYCLE` | error | `validate` | `{ cycle }` | The `needs` form a cycle. One diagnostic per strongly connected component; `cycle` is the path, first element repeated last. |
| `UNKNOWN_STAGE` | error | `validate` | `{ job, stage }` | A job references an undeclared stage. |
| `NEED_LATER_STAGE` | warning | `validate` | `{ job, stage, need, needStage }` | A job needs a job in a later stage. Not evaluated when the job's own stage is unknown. |
| `LAYOUT_INVALID` | warning | `parseLayout` | `{ detail }` | `.devsecops/layout.json` is not valid JSON or does not follow its schema. It is then ignored: detection applies. |
| `LAYOUT_UNKNOWN_LAYER` | warning | `parseLayout` | `{ job, layer }` | An override names a layer absent from the taxonomy. That layer is ignored; the others apply. |
| `LAYOUT_UNKNOWN_JOB` | warning | `parseLayout` | `{ job }` | An override names a job absent from the pipeline. |
| `COVERAGE_LAYER_MISSING` | error | `keelson coverage` | `{ layer, name }` | A layer required by `--require` is not covered. |
| `CATALOG_INVALID_TOOL` | error | `catalog lint` | `{ detail }` | A catalogue entry does not follow the schema. `detail` comes from zod or `yaml`. |
| `CATALOG_DUPLICATE_TOOL` | error | `catalog lint` | `{ tool }` | Two catalogue entries share the same identifier. |
| `CATALOG_UNKNOWN_LOGO` | error | `catalog lint` | `{ tool, logo }` | The catalogue entry names a logo absent from the bundled catalogue. |
| `CATALOG_MISSING_SNIPPET` | error | `catalog lint` | `{ tool }` | A tool of type `job` has no snippet. |
| `CATALOG_STALE_TOOL` | warning | `catalog lint` | `{ tool, lastVerified }` | The catalogue entry has not been verified for more than six months. |
| `WORKFLOW_UNRESOLVED` | info | GitHub `parse` | `{ job, target }` | A `uses:` job calls a reusable workflow, which Keelson does not read. Counted in `Pipeline.unresolved`, so the pipeline is partial ([ADR 0013](adr/0013-github-without-stages.md)). |
| `TOOLCHAIN_INVALID` | error | `parseToolchain` | `{ detail }` | `.devsecops/toolchain.yaml` is not valid YAML or does not follow its schema. The toolchain is then empty, and no operation edits it. |
| `TOOLCHAIN_UNKNOWN_TOOL` | error | `validateToolchain` | `{ service, tool }` | A service names a tool absent from the catalogue. |
| `TOOLCHAIN_UNKNOWN_SERVICE` | error | `validateToolchain` | `{ job, service }` | An integration names an undeclared service. |
| `TOOLCHAIN_UNKNOWN_JOB` | error, or warning | `validateToolchain` | `{ job }` | An integration names a job absent from the pipeline. A warning on a partial pipeline: the job may come from an unresolved include. |
| `TOOLCHAIN_DUPLICATE_INTEGRATION` | warning | `validateToolchain` | `{ job, service, kind }` | The same integration appears twice. |

### Examples

**`INVALID_YAML`**

```yaml
a:
  - x
 bad: [1,
```

```
file.yml:3:2 error INVALID_YAML All mapping items must start at the same column
```

**`INCLUDE_UNRESOLVED`**

```yaml
include:
  - local: ci/jobs.yml
  - template: Jobs/SAST.gitlab-ci.yml
```

The first is resolved, the second is not: a single diagnostic, for the `template`.

```
file.yml:3:5 info INCLUDE_UNRESOLVED this template include is not resolved (Jobs/SAST.gitlab-ci.yml), so the pipeline shown may be incomplete
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
orphan:
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
silent:
  stage: build
```

**`UNKNOWN_NEED`**

```yaml
unit:
  needs:
    - absent
```

```
file.yml:1:1 error UNKNOWN_NEED job "unit" needs "absent", which does not exist
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

## Operation errors

Returned by `apply` in a failed `Result`, and relayed as-is by `@keelson/server`. None is thrown as
an exception: an exception can only signal a Keelson bug.

| Code | `params` | Meaning |
| --- | --- | --- |
| `STALE_DOCUMENT` | `{ expected, received }` | The operation's `baseHash` does not match the document's hash, which has changed since the operation was computed. `expected` is the document's hash, `received` the operation's. Both are in `params` for diagnosis, never in the rendered sentence: two 64-character digests help no reader. |
| `JOB_NOT_FOUND` | `{ job }` | The target job does not exist. A template is not a job. |
| `JOB_REFERENCED` | `{ job, referencedBy }` | `removeJob` on a job that other jobs need. `referencedBy` lists their identifiers; a cascading removal is composed of several operations. This is the only code the UI handles specially: it reads `params.referencedBy` to list the referrers. |
| `NAME_CONFLICT` | `{ name }` | The target name is already taken by a top-level key (job, template or reserved key). |
| `INVALID_NAME` | `{ reason: "job", name }` or `{ reason: "stage" }` | `reason: "job"`: the name is empty, starts with `.`, or is a reserved word — `stages`, `variables`, `include`, `default`, `workflow`, `image`, `services`, `cache`, `before_script`, `after_script`. `reason: "stage"`: empty stage name. `reason: "service"`, with `name`: a service identifier must match `^[a-z0-9][a-z0-9._-]*$`. |
| `STAGE_NOT_FOUND` | `{ stage }` | The target stage is not declared. Implicit stages (`.pre`, `build`, `test`, `deploy`, `.post`) count as declared. |
| `STAGE_EXISTS` | `{ stage }` | `addStage` on a stage that already exists, implicit ones included. |
| `NEED_EXISTS` | `{ job, need }` | `addNeed` on a need already present in the effective value. |
| `NEED_NOT_FOUND` | `{ reason: "notNeeded", job, need }` or `{ reason: "notLocal", job, need }` | `notNeeded`: `removeNeed` on a need absent from the effective value. `notLocal`: the need **is** effective, but the job's `needs` list is not a sequence readable item by item — an anchor alias or a `!reference` — so removing it would require rewriting the shared list, which Keelson does not do. |
| `CYCLE` | `{ operation }` | The operation would create a cycle in the `needs` that did not exist before. Evaluated on the IR of the resulting text, for every operation except `splice`. |
| `UNSUPPORTED_VERSION` | `{ received, supported }` | The operation carries a numeric `v` other than `1`. |
| `INVALID_OPERATION` | union on `reason`, see below | The operation does not follow its schema, or the requested edit is not supported. |
| `RANGE_OUT_OF_BOUNDS` | union on `reason`, see below | A source range cannot be found, or an index falls outside its list. |
| `FROM_INCLUDED_FILE` | union on `reason`, see below | The operation targeted an element that does not live in the main file. Keelson **never** rewrites an included file. |
| `SERVICE_NOT_FOUND` | `{ service }` | The toolchain operation targets an undeclared service. |
| `SERVICE_REFERENCED` | `{ service, jobs }` | `removeService` on a service still linked to jobs. |
| `INTEGRATION_EXISTS` | `{ job, target, kind }` | The integration, or its gap, is already in the file. `target` is the service or the tool. |
| `INTEGRATION_NOT_FOUND` | `{ job, target, kind }` | The integration, or its gap, is not in the file. |

### `FROM_INCLUDED_FILE`

| `reason` | Other `params` | Situation |
| --- | --- | --- |
| `job` | `job`, `file` | The target job comes from an included file. A job included and then **redefined** in the main file belongs to the main file and remains editable: that is GitLab's merge order. |
| `nameTaken` | `name`, `file` | `addJob` or `renameJob` to a name already taken by a key of an included file. Keelson refuses rather than writing a partial override: the resulting job would silently inherit the include's keys. |
| `stages` | `file` | The `stages` list is declared in an included file. `addStage` and `moveStage` are therefore refused; adding a job to one of those stages is still allowed. |
| `referencedByInclude` | `job`, `referencedBy: { job, file }[]` | `renameJob` on a job needed by a job in an included file: renaming without rewriting that file would break its `needs`. |

### `INVALID_OPERATION`

| `reason` | Other `params` | Situation |
| --- | --- | --- |
| `notAnObject` | — | The received body is not a JSON object. |
| `schema` | `path`, `detail` | The zod schema rejects the operation. `detail` is zod's sentence, in English; `path` locates it within the operation, and is `""` when the error concerns the root. |
| `flowStyleJob` | `job` | The job is written in flow style (`{ … }`); editing in place would assume a line-based rendering. |
| `jobWithoutScript` | — | `addJob` without any script line. |
| `inheritedEnvironment` | `job`, `origin` | Removing an inherited environment: GitLab has no cancellation key. `origin` says where it comes from (`extends`, `anchor`, `default`). |
| `sharedValue` | `job`, `key` | The value comes from an anchor alias or a `!reference`, and writing it in place would lose something: `addNeed` on a shared list, or `setJobStage` on a `!reference` carrying an anchor, a comment or an explicit `?` key. |
| `flowStyleToolchain` | `section` | A section of `toolchain.yaml` is written in flow style and is not empty. |
| `invalidToolchain` | — | `toolchain.yaml` carries a `TOOLCHAIN_INVALID`: Keelson does not edit a file it does not understand. |
| `invalidSnippet` | — | `addSnippet`: the text is not the YAML of a single block-style job, without anchors or aliases. |
| `citedInExpression` | `job` | GitHub Actions: `needs.<id>` or `jobs.<id>` appears in an expression, which Keelson does not rewrite. |
| `dynamicExpression` | `job` | GitHub Actions: an expression reads the whole `needs` or `jobs` context, or reads it through a computed index (`toJSON(needs)`, `needs[matrix.dep]`, `jobs[inputs.x]`), and may therefore target `job` without naming it. Only the context root counts: neither `env.NEEDS` nor a `'needs-review'` label. |
| `notForProvider` | `operation` | GitHub Actions: the operation is meaningless, for lack of stages or need options. |
| `invalidLayout` | — | **Server**: `layout.json` is not readable. Keelson does not overwrite what it does not understand. |
| `outsideRoot` | `path` | **Server**: `.devsecops` leads outside the repository. Nothing is written. |
| `noRootMap` | — | The file has no YAML map at its root, and the operation is not a `splice`. |
| `wouldBreakYaml` | `operation` | The resulting text would be invalid YAML; nothing was written. |
| `unreadableBody` | — | **Server**: the request body is not readable JSON. |
| `missingOpId` | — | **Server**: `opId` missing or empty. |
| `missingOp` | — | **Server**: `op` missing or invalid. |

### `RANGE_OUT_OF_BOUNDS`

| `reason` | Other `params` | Situation |
| --- | --- | --- |
| `jobRange` | `job` | Range not found for the job's key. |
| `stageKey` | — | Range not found for the `stage` key. |
| `needsKey` | — | Range not found for the `needs` key. |
| `lastNeed` | — | Range not found for the last element of `needs`. |
| `environmentKey` | — | Range not found for the `environment` key. |
| `stageList` | — | Range not found in the stage list. |
| `emptyStageList` | — | The stage list is empty where an element is expected. |
| `stageIndex` | `index`, `count` | Stage index beyond the list. |
| `textRange` | `start`, `end`, `length` | A `splice` falls outside the text. |

## Transport codes

Returned by `@keelson/server`. Every API error has the shape `{ code, params }`, plus `hash` for the
409 `STALE_DOCUMENT`. **There is no `message` key on the wire**: the text is rendered client-side.

| Code | Status | `params` | Meaning |
| --- | --- | --- | --- |
| `FORBIDDEN_HOST` | 403 | `{}` | The `Host` header is not an expected local form. Refused before any handling. |
| `FORBIDDEN_TOKEN` | 403 | `{}` | Session token missing or invalid on an `/api` route. |
| `METHOD_NOT_ALLOWED` | 405 | `{ method }` | The HTTP method is not the route's. |
| `NOT_FOUND` | 404 | union on `reason`: `unreadableFileName` · `unknownFile {file}` · `missingFile {file}` · `unknownRoute {route}` · `noUiBundle` | `unknownFile`: the file is not in the workspace. `missingFile`: it is, but could not be loaded. `noUiBundle`: this server does not serve a UI bundle. |
| `PAYLOAD_TOO_LARGE` | 413 | `{ limitBytes }` | Request body over the limit. The connection is closed. |
| `INTERNAL_ERROR` | 500 | `{}` | The handler threw. No detail is exposed. |

## Codes forged by the client

No server emits them. They are in the registry so that the exhaustiveness test does not let the UI
render a code without a message.

| Code | `params` | Meaning |
| --- | --- | --- |
| `NETWORK_ERROR` | `{ detail }` | The request did not complete. `detail` is the exception's message. |
| `UNEXPECTED_RESPONSE` | `{}` | The error response does not have the `{ code, params }` shape. |

## Position convention

`SourceRange` carries **character offsets** into the source text, not lines. The CLI converts them
to `line:column` for display, both counted **from 1**.
