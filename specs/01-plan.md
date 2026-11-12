# Keelson — technical plan

## 1. Sources of truth

| Source                      | Owns                                                           | Writing             |
| --------------------------- | -------------------------------------------------------------- | ------------------- |
| The repository's native CI YAML | the pipeline: stages, jobs, dependencies, environments     | in-place patch      |
| `.devsecops/toolchain.yaml` | the services (named instances) and the integrations            | written by Keelson  |
| `.devsecops/layout.json`    | node positions, layer overrides                                | written by Keelson  |

A service is a **named instance**: name, tool type (a reference to the catalogue), URL,
environment. Two Nexus instances on two environments are two services.

## 2. Model

### Pipeline

`Pipeline`, `Stage`, `Job`, `Need` (a dependency between jobs), `Environment`, and `OpaqueBlock` for
everything the IR does not model: scripts, complex `rules`, `extends`, `include`. An opaque block is
kept byte for byte and re-emitted as is.

### Toolchain

`Service` (a named instance) and `Integration` between a job and a service, of type:

- `push` — push an artifact or an image,
- `upload-report` — send a scan report,
- `fetch-secret` — fetch a secret,
- `notify` — notify.

### Taxonomy

`Layer` with a `source: owasp | platform` field. An OWASP layer comes from the Guideline; a platform
category is a necessary building block that the Guideline does not cover.

### Catalogue

`Tool`: covered layers, licence, logo, detection patterns (to infer usage from scripts), snippets
per adapter, `job` or `service` kind, and `lastVerified`.

## 3. OWASP DevSecOps Guideline layers (13)

1. Secrets in git repositories
2. SCA — software composition analysis
3. SAST — static analysis
4. IaC — infrastructure as code security
5. Supply chain — SBOM, signing, provenance, pipeline security
6. IAST — interactive analysis
7. API security
8. DAST — dynamic analysis
9. CNAPP — cloud-native application protection
10. Infrastructure scanning
11. Continuous scanning
12. Compliance
13. AI / LLM security

## 4. Platform categories (outside OWASP)

SCM · artifact repositories and registries · secrets management · vulnerability aggregation ·
server-side code quality · runtime observability · runtime security · policy-as-code.

## 5. YAML round-trip

- Parsing through the **CST** of `yaml` (eemeli), not only the AST: the CST is what carries the
  comments, the order and the anchors.
- Editing by **in-place patch**: the whole document is never regenerated.
- **Tested invariant**: a parse → emit with no change produces identical bytes. Verified in
  milestone L1 on a corpus of 34 files (20 official MIT templates from `gitlab-org/gitlab`, 14
  hand-written fixtures), and by four fast-check properties: round-trip, inverse, determinism,
  locality.
- **Local** `include`s are resolved read-only since milestone L2b: paths from the repository root,
  `*` and `**` wildcards, recursion bounded by cycle detection and by the 150-file limit documented
  by GitLab. Remote forms (`remote`, `project`, `template`, `component`) are not resolved and are
  reported one by one: the pipeline is then **partial**, which the IR states through
  `Pipeline.unresolved` and the UI on screen.
- Each file keeps its own CST: Keelson never builds a merged YAML. The merge is an ordered chain of
  definitions, the same one that already resolved `extends` and anchors. Ranges therefore stay true
  in their own file, and every IR element carries its own.
- **Writing only touches the main file.** Any operation targeting an element that comes from an
  included file is refused with `FROM_INCLUDED_FILE`. An element that is included and then redefined
  in the main file belongs to the main file, and therefore stays editable — that is GitLab's merge
  order.

## 6. Integrations

Inferred from job scripts through the catalogue's detection patterns, then **confirmed or
corrected** in `.devsecops/toolchain.yaml`. The inference proposes, the file decides (ADR 0010). A
`service` catalogue entry declares its integration type, and `dismissed` keeps what the user
discards.

## 7. Views

- **Pipeline** — stages, jobs, dependencies.
- **Toolchain** — services and integrations around the pipeline.
- **OWASP overlay** — projected coverage, with an "uncovered" panel and tool proposals from the
  catalogue.
- **Catalogue** — the tools, filterable by layer and by licence.

## 7a. Serializable operations

Every edit goes through an **operation**: a plain JSON object, validated by a zod schema, carrying
`v: 1` and a `baseHash` (SHA-256 of the text it was computed on). `apply` rejects a stale
`baseHash` (`STALE_DOCUMENT`) and an unknown version (`UNSUPPORTED_VERSION`).

Each application returns an `inverse`: a `splice` operation that restores the original bytes,
anchored on the hash of the new text. `splice` is the universal inverse — any operation, however
structured, is undone by a range replacement.

Consequence: a sequence of edits is **portable**. It can be computed on one side and applied on the
other, logged, replayed, undone. This is the basis of **milestone L8 (fleet)**: producing operations
for N repositories from a single place, then applying them in bulk through `keelson apply ops.json`.
`--rebase` re-anchors each `baseHash` on each repository's text, which makes a single file
applicable to repositories whose texts differ; writing is all-or-nothing per repository
([milestones/l8.md](milestones/l8.md)). Since error codes are public contracts documented in
[diagnostics.md](diagnostics.md), a remote client can interpret a refusal without reading the code.

## 7b. Local server and security model

`npx keelson start` starts a `node:http` server that **is authoritative over the disk**. The UI
never writes a file and does not run the adapter: it sends operations, and the server applies them
and writes.

### API

| Method | Route | Responses |
|---|---|---|
| GET | `/api/workspace` | 200 `{ files: [{ path, adapter }] }`, `adapter` being `gitlab` or `github` |
| GET | `/api/catalog` | 200 `{ tools, logos, layers }` |
| GET | `/api/documents/:file` | 200 `{ text, pipeline, diagnostics, hash, included, coverage }` · 404 |
| POST | `/api/documents/:file/operations` | body `{ op, opId }` → 200 `{ text, pipeline, diagnostics, hash, inverse, touched, included, coverage }` · 400 `INVALID_OPERATION` · 404 · 409 `STALE_DOCUMENT` with the current `hash` · 413 · 422 `{ code, params }` |
| POST | `/api/documents/:file/preview` | body `{ op }` → 200 the result without writing · same refusals as an operation |
| GET | `/api/toolchain` | 200 `{ text, hash, toolchain, diagnostics, proposed, positions }` |
| POST | `/api/toolchain/operations` | body `{ op, opId }` → 200 the same body plus `inverse` · 400 · 409 with the current `hash` · 422 |
| PUT | `/api/layout/positions` | body `{ positions }`, merged into the file → 200 with the complete map · 400 · 422 if `layout.json` is unreadable |
| GET | `/api/events` | SSE `document.changed { file, hash }`, `document.removed { file }`, `coverage.changed { file }`, `toolchain.changed { hash }`, `workspace.changed { files: [{ path, adapter }] }` (same list as `GET /api/workspace`), heartbeat every 15 s |
| GET | `/*` | UI bundle, SPA fallback to `index.html` |

The `diagnostics` in these responses combine those of `parse` **and** those of `validate`, as
`keelson validate` does: the API and the CLI say the same thing about the same file. Every error has
the shape `{ code, params }`, plus `hash` on the 409, with the codes and the shape of their `params`
documented in [diagnostics.md](diagnostics.md). **No `message` key is on the wire**: the server
produces no text, and the client renders the sentence through `render()` from
`@keelson/core/messages` ([ADR 0002](adr/0002-language-and-messages.md)).

### Write guarantees

- **Atomic**: temporary file in the same directory, `fsync`, `rename`, original file mode
  preserved. On failure the temporary file is removed and the original stays intact.
- **Serialized per document**: one queue per file, never two `apply`s in parallel on the same
  document.
- **Idempotent**: each request carries an `opId`; the last 100 per document are remembered with
  their response, and a replayed `opId` returns the same response without rewriting.
- **Included files**: the server also watches the directory of each resolved included file, and a
  change there triggers a reload of the **main document**, then a `document.changed` on it. Since
  Keelson never writes an included file, there is no own write to silence: the hash guard only
  applies to the main file. The watched set is recomputed on every load, because it changes as soon
  as the `include` key changes.
- **External changes**: the server watches the **directory** and filters on the file name, because
  an editor often replaces the file through a `rename` — watching the file alone would miss the
  event. After a change it rereads: if the hash is the one it knows, it is its own write and it stays
  silent; otherwise it re-parses and emits `document.changed`. File gone → `document.removed`.
- **Workspace changes**: the server also watches the root, `.github` and `.github/workflows`. A
  workflow or a `.gitlab-ci.yml` created or removed while it runs updates the file list and emits
  `workspace.changed` with the whole new list; a loaded file that leaves the list first gets its
  `document.removed`. A deleted then recreated `.github/workflows` is watched again.

### Security model

The server runs on the user's machine, alongside other web pages open in the same browser. It must
therefore defend itself against them.

- **Listens on `127.0.0.1` only**, with no option to change the interface. Nothing is exposed to the
  local network.
- **`Host` header checked before any processing**: only `127.0.0.1:<port>` and `localhost:<port>`
  are accepted, anything else returns 403. This is the defence against *DNS rebinding*, where a name
  controlled by a third party resolves to `127.0.0.1`.
- **32-byte session token** (`node:crypto`), different at every start. It is passed only once, in
  the opened URL (`?token=`), then the UI removes it from the address bar with
  `history.replaceState` and sends it in the `X-Keelson-Token` header on every call. `/api/events`
  takes it as a query parameter, since `EventSource` cannot set a header.
- **Constant-time comparison** on SHA-256 digests, hence independent of the length of the presented
  token.
- **Files bounded to the workspace list**: `:file` is resolved by lookup in that list, not by path
  concatenation. A path containing `..`, or a real but undetected file, returns 404.
- **Body limited to 1 MB**, 413 beyond that.
- The UI bundle is served without a token: it contains no user data, and the `Host` check still
  applies.

## 8. CLI

| Command | Effect |
| ------------------------------- | ------------------------------------------------------------ |
| `keelson start [directory] [--port <n>] [--no-open]` | opens the local web UI, free port by default |
| `keelson validate [file] [--format text\|json]` | validates the pipeline and the toolchain; 1 on an error |
| `keelson coverage [file] [--require <layers>] [--format text\|json]` | 1 if a required layer is missing, 2 if a requested layer does not exist |
| `keelson export [file] [--format markdown\|mermaid\|json]` | exports the model, formats in [export.md](export.md) |
| `keelson catalog lint [directory]` | without a directory, the embedded catalogue; 1 on an error, 0 on a mere freshness warning |
| `keelson apply <ops.json> [<repository>...] [--file <path>] [--rebase] [--dry-run] [--json]` | applies a sequence of operations to each repository, all-or-nothing per repository; 1 if a repository fails, 2 on an invalid operations file |

Every command accepts `-h` / `--help`, which prints its usage without running it. Without `[file]`,
`validate`, `coverage` and `export` apply to every CI file in the repository.

## 9. Logos and licences

**Simple Icons** (CC0) first, provided by the **`simple-icons` npm package as a devDependency**: the
SVGs come with their licence, at a version pinned by `bun.lock`, with no on-the-fly download at
build or run time. Decided on 2026-10-22; `curl` is not allowed for logos in
`.claude/settings.json`.

A vendor logo is embedded only if its brand guidelines explicitly allow it; otherwise, the layer's
generic icon. Each tool's licence is shown in the catalogue.

## 10. Catalogue freshness

Each tool carries a `lastVerified` field. `keelson catalog lint` flags tools not verified for more
than six months.

## 11. Milestones

Milestone branches are named `milestone/<id>-<slug>`; branches of milestones delivered before this
convention keep their historical `lot/<id>-<slug>` names.

| Milestone | Content                                                                 |
| --------- | ----------------------------------------------------------------------- |
| L0  | Foundation: monorepo, tooling, CI, specs, conventions                           |
| L1  | `core` + `adapter-gitlab`, round-trip validated on a real corpus                |
| L2  | UI Pipeline view: reading, then editing                                         |
| L2c | Messages: `core` renders `code` + `params`, English only (ADR 0002)             |
| L2b | Resolution of local `include`s, per-file origin, writing bounded to the main file |
| L3  | `taxonomy` + `catalog` + OWASP overlay                                          |
| L4  | `toolchain`: file, integration inference, view                                  |
| L5  | Tool proposals and job insertion                                                |
| L6  | `adapter-github`                                                                |
| L7  | Open source packaging: documentation, CONTRIBUTING, npm publication. Language is no longer handled there: see ADR 0002 and milestone L2c |
| L8  | Fleet: `keelson apply ops.json`, editing N repositories from a single place     |
