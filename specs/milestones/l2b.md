# Milestone L2b — resolving local `include`s

Scoping written before any line of code, from the real code of `main` at `c1c15e4`.

The milestone closes the 2026-10-20 gap "`include`s are not resolved" and the two 2026-10-22 gaps
that depend on it: the partial-pipeline indicator, and the severity of
`EXTENDS_TARGET_NOT_FOUND`.

## 1. GitLab semantics, checked against the official documentation

Source: <https://docs.gitlab.com/ci/yaml/includes/> and <https://docs.gitlab.com/ci/yaml/#includelocal>,
consulted on 2026-10-23. Quotations in quotation marks.

| Point | What GitLab says | Consequence for Keelson |
| --- | --- | --- |
| Path form | "a full path relative to the root directory (`/`)"; "The YAML file must have the extension `.yml` or `.yaml`" | The path is resolved from the repository root, **never** relative to the including file. The leading `/` is optional and stripped during normalisation. Any other extension is rejected. |
| Branch | "The `.gitlab-ci.yml` file and the local file must be on the same branch" | Keelson reads the working tree: the constraint holds by construction. |
| Wildcards | "You can use `*` and `**` wildcards in the file path" | `*` does not cross a `/`, `**` does. `configs/*.yml` does not match subfolders, `configs/**.yml` does, `configs/**/*.yml` matches **only** subfolders. |
| Submodules | "You can't include local files through Git submodules paths" | Out of scope: Keelson does not read submodules. |
| Merge order | "After all configuration added with `include` is merged together, the main configuration is merged with the included configuration." | Includes first, in written order, **then** the main file on top. The main file wins. |
| Between includes | "the last included file takes precedence when merging the configuration from the included files" | Last included wins. |
| Duplicates | "The last time the configuration is included overrides any previous times the file was included." | A file included twice is **not** deduplicated: it enters the merge order twice. |
| Key merging | deep merge of maps; "arrays cannot be merged" | A list overwrites, a map merges. This is exactly what the `sources` chain of `extends` already does. |
| Override | "you can override the included configuration values to adapt them to your pipeline requirements" | A job coming from an include and partially redefined in the main file is a single, merged job. |
| Limit | "The maximum number of nested included files for a pipeline is 150." | A **total count**, not a nesting depth. |
| Context | "`include` configuration is always evaluated based on the location of the file containing the `include` keyword, not the project running the pipeline." | No effect here: one repository, one root. |

### Deliberate divergence on "maximum depth"

The milestone brief asks for "documented cycle detection and maximum depth, each with its own
diagnostic code". GitLab documents **no** nesting-depth limit: it documents a **total count** limit
of 150 included files. Inventing a maximum depth would make Keelson stricter than its target, which
is exactly the defect already recorded as a gap for `MAX_EXTENDS_DEPTH`. The milestone therefore
delivers:

- `INCLUDE_CYCLE` — a file includes itself, directly or not; this is what actually bounds the
  recursion;
- `INCLUDE_LIMIT_EXCEEDED` — the total count of 150 is reached, with the limit in the `params`.

Two codes, each for a real bound. The depth bound is not implemented because it does not exist in
the target.

## 2. Inventory of the existing code

### What deals with `include` today

| Location | What happens there |
| --- | --- |
| `packages/adapter-gitlab/src/parse.ts:86-94` | `localPair(root, "include")`; if the key exists, a single `INCLUDE_UNRESOLVED` at `info`, `params: {}`, without looking at the form or the content. |
| `packages/adapter-gitlab/src/parse.ts:132` | `extendsSeverity: includePair === undefined ? "error" : "warning"` — the degradation to compensate for. |
| `packages/adapter-gitlab/src/parse.ts:114` | `isReservedTopLevel("include")` ⇒ the `include` key becomes a top-level `OpaqueBlock`. |
| `packages/adapter-gitlab/src/defaults.ts:11` | `include` is in `RESERVED_TOP_LEVEL`, hence a forbidden job name. |
| `packages/core/src/operations.ts:39` | same in `RESERVED_JOB_NAMES`. |
| `specs/diagnostics.md:39` | `INCLUDE_UNRESOLVED`, `info`, `params: {}`. |
| `packages/core/src/messages/en.ts:21` | "includes are not resolved: the pipeline shown contains only this local file". |
| `packages/adapter-gitlab/test/corpus/edge-cases/with-include.gitlab-ci.yml` | the only `include` fixture, a single file. |

### Surfaces the milestone touches

| Surface | File | Change |
| --- | --- | --- |
| `Diagnostic` | `packages/core/src/diagnostics.ts` | gains `file: string`: with several files, a range without a file no longer locates anything. |
| `Job`, `Template`, `Stage` | `packages/core/src/ir.ts` | gain `file: string`. |
| `Pipeline` | `packages/core/src/ir.ts` | gains `main`, `files`, `unresolved`. |
| `Origin` | `packages/core/src/ir.ts` | gains `{ kind: "include"; file: string }`. |
| `parse` | `packages/adapter-gitlab/src/parse.ts` | `parse(text, options?)` with `file` and `read`. |
| `GitlabDocument` | `packages/adapter-gitlab/src/document.ts` | carries the include context `apply` needs. |
| `apply` | `packages/adapter-gitlab/src/apply.ts` | rejects any operation targeting an element of an included file. |
| CLI | `packages/cli/src/validate.ts` | on-disk reader, and the diagnostic's `file` in `file:line:column`. |
| Server | `store.ts`, `watcher.ts`, `workspace.ts` | reader, watching of included files, write allowlist unchanged. |
| UI | `api/client.ts`, `views/`, `panels/`, `editing/` | origin displayed, editing disabled, partial-pipeline indicator. |

### The ten sites that produce a diagnostic

`resolve.ts:129` and `:140`; `parse.ts:76`, `:90`, `:154`; `validate.ts:151`, `:170`, `:181`,
`:193`. Each must now name its file. `validate()` takes it from the job concerned, which carries
it.

## 3. Scoping decisions

All reversible except D1 and D3, which go to ADRs.

**D1 — the reader is synchronous, and this is an architecture decision.** `parse` is synchronous and
`apply` calls `parse` to obtain the CST. Making `parse` asynchronous would contaminate `apply`, hence
the whole editing chain, for no gain: included files are few and already in the file system cache.
The reader is therefore an injected synchronous interface. **ADR 0005.**

**D2 — the reader interface does not glob.** It exposes `read(path)` and `candidates()`. Translating
a `*`/`**` pattern into a match lives **in the adapter**, hence testable on an object literal,
without a disk. `candidates()` is only called if a pattern contains a wildcard.

**D3 — resolution produces a chain of maps per key, not a merged document.** Keelson never builds a
merged YAML: each file keeps its CST and its offsets, and the merge is an ordered list of `Source`s
— exactly the mechanism that already resolves `extends` and anchors. Consequence: ranges stay true
in their file, and in-place writing remains possible. **ADR 0006.**

**D4 — a job's owner is its *last* contributor.** A job defined in an include and redefined in the
main file belongs to the main file, so it stays editable. This follows directly from GitLab's merge
order, and it is also the file a user would edit by hand.

**D5 — `Diagnostic.file` is always present.** No `undefined` meaning "the main file": that is
precisely the kind of absent value milestone L2c spent its day removing from renderings.

**D6 — `parse(text)` without options stays legal**, with `file` defaulting to `.gitlab-ci.yml` and
no reader. Without a reader, no include is resolved and the behaviour is today's, except that the
form of each include is now named.

**D7 — `INCLUDE_UNRESOLVED` changes the shape of its `params`**, from `{}` to `{ form, detail }`.
This is a contract break in the sense of `specs/diagnostics.md`, and a deliberate one: the code has
existed since L1, no external client consumes the API yet, and a partial-pipeline indicator that
cannot say *what* is missing is worthless. `form` reuses GitLab's vocabulary: `remote`, `project`,
`template`, `component`.

**D8 — the order of a wildcard's files is lexicographic.** GitLab does not document it.
Determinism is a tested property of the project, and the merge order decides which value wins: an
unspecified order is an unspecified result.

**D9 — the severity of `EXTENDS_TARGET_NOT_FOUND` follows *unresolved includes*, not the presence
of an `include` key.** Today it is degraded as soon as an `include` key exists. After this
milestone, it stays `error` if all includes are resolved — even if there are some — and only drops
to `warning` if at least one unresolved include can explain the absence.
*Clarified on 2026-11-04 by ADR 0007: a broken local include does not degrade it.*

## 4. Diagnostic and error codes added

| Code | Family | Severity / status | `params` |
| --- | --- | --- | --- |
| `INCLUDE_UNRESOLVED` *(shape changed)* | diagnostic | info | `{ form: "remote" \| "project" \| "template" \| "component"; detail: string }` |
| `INCLUDE_NOT_FOUND` | diagnostic | error | union on `reason`: `missing { path }` · `notYaml { path }` · `outsideRoot { path }` · `malformed` |
| `INCLUDE_CYCLE` | diagnostic | error | `{ trail: readonly string[] }` |
| `INCLUDE_LIMIT_EXCEEDED` | diagnostic | error | `{ limit: number }` |
| `FROM_INCLUDED_FILE` | operation error | 422 | union on `reason`: `job { job, file }` · `stages { file }` · `referencedByInclude { job, file, referencedBy }` |

`outsideRoot` is a security measure, not a conformance one: an `include: local: ../../etc/passwd`
must be rejected before any read, because Keelson's server reads the disk on behalf of a web page.

## 5. Target tree

```
packages/core/src/
  ir.ts                      Job.file, Template.file, Stage.file, Pipeline.main/files/unresolved,
                             Origin { kind: "include" }, isPartial()
  diagnostics.ts             Diagnostic.file
  messages/codes.ts          the four new codes + FROM_INCLUDED_FILE
  messages/en.ts             their sentences, branches included
  validate.ts                assigns the job's file to each diagnostic

packages/adapter-gitlab/src/
  includes.ts                NEW — IncludeReader, normalisation, patterns, graph, cycle, limit
  parse.ts                   parse(text, options), multi-file lookup, file on every element
  resolve.ts                 cross-file source chain
  document.ts                include context carried by the document
  apply.ts                   FROM_INCLUDED_FILE rejection

packages/cli/src/
  reader.ts                  NEW — IncludeReader on node:fs, memoised
  validate.ts                diagnostic's file in file:line:column

packages/server/src/
  reader.ts                  NEW — same reader, bounded to the workspace root
  store.ts                   parse with a reader, exposes included files
  watcher.ts                 also watches the folders of included files
  app.ts                     read route for an included file

packages/ui/src/
  (to be scoped by /impeccable shape) origin badge, editing disabled, partial indicator
```

## 6. API

### `IncludeReader`

```ts
export type IncludeReader = {
  /** Normalised `path`: relative to the root, `/` separators, no leading `/`.
   *  `null` if the file does not exist or is not readable. */
  read(path: string): string | null;
  /** Every `.yml`/`.yaml` file in the repository, normalised. Only called for a pattern. */
  candidates(): readonly string[];
};
```

### `parse`

```ts
export type ParseOptions = {
  /** Path of the main file, relative to the root. Default: `.gitlab-ci.yml`. */
  file?: string;
  /** Absent ⇒ no include resolved, each one reported by its form. */
  read?: IncludeReader;
};
export function parse(text: string, options?: ParseOptions): ParseResult;
```

### Server

`GET /api/documents/:file` responds for the **main file** only. Its payload gains
`included: Record<path, text>`, and the `pipeline` carries `main`, `files` and `unresolved`.

**Correction of 2026-10-23: the `GET /api/includes/:file` route announced here was not written**,
and must not be. The texts of included files travel in the document payload. Three reasons: the
ranges of opaque blocks are offsets into those texts, and a separate route would let them drift out
of alignment between two requests; a second disk-reading surface would be a second boundary to
bound; and the client cannot request a file outside the resolution, since it requests nothing. The
**write** allowlist remains the main file alone.

## 7. Test tree

```
packages/adapter-gitlab/test/
  includes.test.ts              normalisation, patterns, cycle, limit, merge order
  includes.golden.test.ts       golden IR of each corpus tree
  corpus/includes/
    simple/                     .gitlab-ci.yml + ci/jobs.yml
    nested/                     include that includes an include
    mixed-list/                 local + relative string + remote in a single list
    override/                   included job partially redefined in the main file
    wildcard/                   configs/*.yml, three files, lexicographic order
    cycle/                      a includes b, b includes a
    missing/                    include pointing to a missing file
    extends-across/             extends whose target is in an included file
    reference-across/           !reference whose target is in an included file
    stages-from-include/        stages declared only in the include
    remote-only/                remote include alone, partial pipeline
  corpus/goldens/includes/      one golden per tree
  operations/includes.test.ts   every operation rejected on an included element
  properties/                   the four properties extended to trees

packages/core/test/
  messages.test.ts              exhaustiveness, branches of the new reasons
  validate.test.ts              the file assigned to each diagnostic

packages/cli/test/validate.test.ts     file:line:column of the right file
packages/server/test/includes.test.ts  bounded reader, watcher, read route
packages/ui/test/                      origin displayed, editing disabled, partial indicator
packages/ui/e2e/includes.e2e.ts        on the real binary, multi-file tree
```

### Testing rules of the milestone

- Every invariant test is **proven red** by reintroducing the real defect, then the file is
  restored by rewriting it and `git diff` checked empty. Never `git stash`.
- **No `try/catch` or fallback** in production code must be able to swallow the failure of the test
  that watches it. This is finding no. 1 of milestone L2c: a safety net added in `render()` had
  made the same milestone's coverage test inert. Every branch-coverage test therefore calls the
  table directly, without going through the entry point that falls back.
- The **locality** property gains a clause: no operation ever modifies the content of an included
  file. Checked on the files' bytes, not on the operation's intent.
- A computed field with no effect on screen is either wired up or removed.

## 8. Definition of done

1. `bun install --frozen-lockfile` with no change.
2. `bun run check` green from a tree without any `dist/`, `types/` or `*.tsbuildinfo`.
3. `bun run e2e` green on the built binary.
4. The built binary run under `node` resolves a multi-file tree and names the right file.
5. `grep` finds no French message in `packages/*/src` outside comments and tests.
6. `/impeccable shape` before the UI surfaces, then `critique`, `audit`, `polish`; `document` if
   the tokens change.
7. Read-only independent review in an isolated worktree, triage per ADR 0003.
8. The three in-scope gaps closed with their proof; every new finding recorded.
9. Log in `specs/progress.md`: commits, test counts, ADRs, debts, gaps, divergences, and every test
   found unable to fail, with its cause.
10. `git merge --no-ff` into `main`, then `bun run check` green on `main`. Next milestone: L3.
