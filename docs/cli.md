# CLI reference

Every command runs locally and needs no network access. `keelson <command> --help` prints the usage
of one command; `keelson --help` lists them all.

| Command | Purpose | Exit codes |
| --- | --- | --- |
| [`start`](#keelson-start) | Local web UI on a repository | `0` on shutdown, `2` on bad arguments |
| [`validate`](#keelson-validate) | Pipeline and toolchain diagnostics | `0` clean or warnings only, `1` on any error, `2` on bad arguments |
| [`coverage`](#keelson-coverage) | OWASP DevSecOps coverage, CI gate | `0`, `1` if a required layer is missing, `2` on an unknown layer |
| [`export`](#keelson-export) | Markdown, Mermaid or JSON export | `0`, `2` on bad arguments |
| [`catalog lint`](#keelson-catalog-lint) | Lint a tool catalogue | `0`, `1` on an error (staleness alone is a notice) |
| [`apply`](#keelson-apply) | Replay operations on one or many repositories | `0`, `1` if any repository failed, `2` on an invalid operations file |

When a command takes an optional `[file]` and you omit it, it covers **every CI file of the
repository**: `.gitlab-ci.yml` and `.github/workflows/*.yml`. Name one file to restrict it.

---

## `keelson start`

```sh
keelson start [dir] [--port <n>] [--no-open]
```

Opens the web UI on `dir` (default: the current directory). The server binds to `127.0.0.1` only, on
a free port unless `--port` is given, and prints a URL carrying a one-time session token. `--no-open`
prints the URL without opening a browser.

Edits made in the UI are written to your files atomically. Undo and redo are available for every
edit; nothing is written without an explicit action.

## `keelson validate`

```sh
keelson validate [file] [--format text|json]
```

Parses the pipeline (resolving local `include:` on GitLab), validates it (unknown needs, needs
cycles, unknown stages, needs pointing to a later stage, jobs without a script…), and checks
`.devsecops/toolchain.yaml` and `.devsecops/layout.json`.

Text output, one line per diagnostic:

```text
/repo/.gitlab-ci.yml:42:5 error UNKNOWN_NEED job "deploy" needs "biuld", which does not exist
```

`--format json` prints an array of `{ file, code, severity, params, message, line, column }`.
`code` and `params` are the stable contract, documented in
[specs/diagnostics.md](../specs/diagnostics.md); `message` is the rendered English text.

## `keelson coverage`

```sh
keelson coverage [file] [--require <layers>] [--format text|json]
```

Reports, for each of the 13 OWASP DevSecOps layers and 8 platform categories, whether it is covered
and by which jobs or declared services.

```text
covered  secrets                   Secrets in git  gitleaks
missing  sast                      Static analysis
covered  supply-chain              Supply chain  sbom
```

`--require` takes a comma-separated list of layer ids and exits `1` if any of them is not covered —
this is the CI gate:

```sh
keelson coverage --require secrets,sca,sast,supply-chain
```

Layer ids: `secrets`, `sca`, `sast`, `iac`, `supply-chain`, `iast`, `api`, `dast`, `cnapp`,
`infrastructure`, `continuous`, `compliance`, `ai`, and the platform categories `scm`, `registry`,
`secrets-management`, `vulnerability-aggregation`, `code-quality`, `observability`,
`runtime-security`, `policy`.

Detection reads job images, scripts (parsed as a minimal shell, so a tool name inside a quoted string
or a comment does not count) and GitHub Actions `uses:`. A layer override in
[`layout.json`](configuration.md#devsecopslayoutjson) replaces the detection for one job.

## `keelson export`

```sh
keelson export [file] [--format markdown|mermaid|json]
```

Exports the model: a Markdown coverage report (default), a Mermaid flowchart of the pipeline and its
services, or the full JSON model. Formats are specified in [specs/export.md](../specs/export.md).

```sh
keelson export --format mermaid > pipeline.mmd
```

## `keelson catalog lint`

```sh
keelson catalog lint [dir]
```

Lints `tools/*.yaml` in `dir` against the catalogue schema (licence, layers, detection patterns that
compile, snippets that parse, logos that exist). Without `dir`, lints the catalogue embedded in the
binary. Entries whose `lastVerified` date is old are reported as notices; a date after today is an
error.

## `keelson apply`

```sh
keelson apply <ops.json> [repo...] [--file <path>] [--rebase] [--dry-run] [--json]
```

Applies a sequence of [operations](#operations) to each repository (default: the current directory),
in order, each on the result of the previous one. For each repository it is **all or nothing**: the
file is written once, atomically, only if every operation succeeds. A failing repository does not
stop the others.

| Option | Effect |
| --- | --- |
| `--file <path>` | CI file inside each repository (default: `.gitlab-ci.yml`) |
| `--rebase` | Anchor each operation on the current text of each repository instead of its `baseHash` |
| `--dry-run` | Print a unified diff per repository and write nothing |
| `--json` | Print `{ results: [{ repo, ok, applied, written, hash?, error? }] }` |

Without `--rebase`, an operation whose `baseHash` does not match the file is refused with
`STALE_DOCUMENT` — the safe default when an operations file was computed on a specific revision.
With `--rebase`, one operations file can be replayed across many repositories whose files differ.

```sh
keelson apply add-secret-scan.json services/* --rebase --dry-run
keelson apply add-secret-scan.json services/* --rebase --json > report.json
```

Paths that leave a repository (`--file ../x`, symlinks pointing outside) are refused.

### Operations

An operation is a JSON object with `v: 1`, a `baseHash` (SHA-256 of the text it was computed on) and
a `kind`. Every successful operation returns an inverse `splice` that restores the original bytes.

| Kind | Fields | GitLab | GitHub |
| --- | --- | --- | --- |
| `addJob` | `job: { id, stage, script[], needs?, environment? }` | yes | yes, without need options |
| `removeJob` | `id` | yes | yes |
| `renameJob` | `from`, `to` | yes | yes |
| `setJobStage` | `id`, `stage` | yes | no (no stages) |
| `addNeed` | `id`, `need: { job, optional?, artifacts? }` | yes | yes, without `optional` / `artifacts` |
| `removeNeed` | `id`, `job` | yes | yes |
| `setEnvironment` | `id`, `environment: { name, url?, action? } \| null` | yes | yes, without `action` |
| `addStage` / `moveStage` | stage name and position | yes | no (no stages) |
| `addSnippet` | `id`, `stage`, `snippet` (a catalogue snippet) | yes | yes |
| `composite` | `steps[]` | yes | yes |
| `splice` | `start`, `end`, `text` | yes | yes |

On GitLab, `setEnvironment` with `null` on a job that inherits an environment (through `extends`,
a merge key or an include) writes `environment: null` in the job, which is how GitLab excludes an
inherited key. Refusals carry a stable `{ code, params }`; see
[specs/diagnostics.md](../specs/diagnostics.md).
`keelson apply` currently targets GitLab CI files; GitHub workflows are edited through the UI.
