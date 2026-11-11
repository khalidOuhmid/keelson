# Milestone L2c — messages: `code` + `params`, English only, `details` merged

Scoping document written **before** any line of code, from the inventory of the repository at
`b8106c2`. It carries out [ADR 0002](../adr/0002-language-and-messages.md), supplemented by the
2026-10-22 gap on `@keelson/server`.

## Purpose

Separate the contract from its rendering. `core`, the adapters and `@keelson/server` now only produce
typed `code` + `params`; a single module, `@keelson/core/messages`, renders their English text, and
both the CLI and the UI go through it. `details` disappears, merged into `params`.

## Inventory

### 1. Existing codes and their origin

**Diagnostics** (9 codes, `packages/core/src/diagnostics.ts:12-20`):

| Code | Emitted by | File and line |
|---|---|---|
| `INVALID_YAML` | adapter | `adapter-gitlab/src/parse.ts:74` |
| `INCLUDE_UNRESOLVED` | adapter | `adapter-gitlab/src/parse.ts:88` |
| `EXTENDS_TARGET_NOT_FOUND` | adapter | `adapter-gitlab/src/resolve.ts:138` |
| `EXTENDS_CYCLE` | adapter | `adapter-gitlab/src/resolve.ts:127` |
| `JOB_WITHOUT_SCRIPT` | adapter | `adapter-gitlab/src/parse.ts:153` |
| `UNKNOWN_NEED` | core | `core/src/validate.ts:179` |
| `NEEDS_CYCLE` | core | `core/src/validate.ts:149` |
| `UNKNOWN_STAGE` | core | `core/src/validate.ts:168` |
| `NEED_LATER_STAGE` | core | `core/src/validate.ts:191` |

**Operation errors** (13 codes, `packages/core/src/operations.ts:6-18`). Two sites in `core`
(`parseOperation`), all the others in `adapter-gitlab/src/apply.ts` through its local `fail()`:

| Code | Sites | File and line |
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
| `INVALID_OPERATION` | 8 | see § 2 |
| `RANGE_OUT_OF_BOUNDS` | 16 | see § 2 |

**Server transport codes** (6 codes, **not documented in `specs/diagnostics.md`**, not declared as
constants, written as literals at each site):

| Code | Status | Sites |
|---|---|---|
| `FORBIDDEN_HOST` | 403 | `server/src/app.ts:63` |
| `FORBIDDEN_TOKEN` | 403 | `server/src/app.ts:77` |
| `METHOD_NOT_ALLOWED` | 405 | `app.ts:84, 93, 103, 159, 179` |
| `NOT_FOUND` | 404 | `app.ts:109, 166, 174, 184` · `store.ts:162, 180` |
| `PAYLOAD_TOO_LARGE` | 413 | `app.ts:116` |
| `INTERNAL_ERROR` | 500 | `server/src/index.ts:58` |

The server also re-emits `INVALID_OPERATION` for three envelope errors
(`app.ts:133, 139, 143`) and relays as is the `code` of `parseOperation` and `apply`
(`store.ts:170, 192`).

### 2. Message strings produced outside the future module

**All** the strings below disappear. French ones are marked **FR**.

`packages/core/src/validate.ts` — **FR**: `:152` needs cycle, `:171` unknown stage, `:182` unknown
need, `:194` need in a later stage. Plus `:10`, an internal `throw new Error`.

`packages/core/src/operations.ts` — **FR**: `:181` "an operation must be a JSON object", `:189`
unsupported version, `:201` `${path} : ${detail}` from zod.

`packages/adapter-gitlab/src/parse.ts` — `:77` `error.message` from the `yaml` library (English, see
D2); **FR** `:91` unresolved includes, `:156` job without script.

`packages/adapter-gitlab/src/resolve.ts` — **FR** `:130` extends cycle, `:141` missing extends
target. `:162` deduplicates **by `code` + `message`**, which must change (D5).

`packages/adapter-gitlab/src/apply.ts` — 44 calls to `fail()`, all **FR**. The two catch-all codes,
which led to decision D1:

- `INVALID_OPERATION`, 8 distinct texts: `:121` flow-style job, `:203` job without script, `:531`
  inherited environment that cannot be removed, `:772` no YAML map at the root, `:791` invalid YAML
  produced, plus `core/src/operations.ts:181` and `:201`, plus the server's three envelope ones.
- `RANGE_OUT_OF_BOUNDS`, 9 distinct texts: `:261` and `:316` range of a job, `:343` `stage` key,
  `:401/413/473` `needs` key, `:406/428` last need, `:525/545` `environment` key,
  `:607/613/621/677/690` stage list, `:632/699` empty stage list, `:586` and `:655` index outside
  the list, `:708` range outside the text.

`packages/adapter-gitlab/src/emit.ts:24` — **FR**, internal `throw new Error`.

`packages/server/src/app.ts` — **FR** `:63, 77, 84, 93, 103, 109, 117, 133, 139, 143, 159, 166,
174, 179, 184`. `packages/server/src/store.ts` — **FR** `:162, 180`.
`packages/server/src/index.ts:58` — **FR** "internal error".

`packages/cli/src/validate.ts` — **FR** `:21` usage prefix, `:35` extra file, `:41` unknown format,
`:82` "no diagnostics", `:101` not a file, `:105` file not found. Plus `:73`, which normalises
`diagnostic.message` and will have to normalise the rendering.

`packages/cli/src/start.ts` — **FR** `:51, 72, 81, 83, 90, 106, 107`.
`packages/cli/src/run.ts` — **FR** `:19-22` descriptions, `:29-36` help text, `:74` unimplemented
command, `:81` unknown command.

`packages/ui/src/main.tsx:8` — **FR**, internal `throw new Error`.

### 3. Current and target shape of API errors

Current, `ErrorBody` (`server/src/store.ts:34`) and the `fail()` of `app.ts:29`:

```ts
{ code: string; message: string; details?: unknown; hash?: string }
```

Target:

```ts
{ code: MessageCode; params: ParamsOf<MessageCode>; hash?: string }
```

`message` disappears from the wire. `ApiFailure` (`ui/src/api/client.ts:26`) follows: `params`
replaces `details`, and `message` is no longer received but **computed** by `render()`. Its current
fallback "unexpected server response" becomes the code `UNEXPECTED_RESPONSE`, and `NETWORK_ERROR` —
today invented on the client side with the exception's text — becomes a code with `params.detail`.
Both are client codes, not server codes; they enter the registry so that the exhaustiveness test
does not leave them out.

## Decisions made during scoping

All reversible, hence settled here without an ADR. At the end of the milestone ADR 0002 receives the
one line it is missing, about its scope.

**D1 — a `reason` discriminant in the `params`, no new code.** `INVALID_OPERATION` and
`RANGE_OUT_OF_BOUNDS` each cover several distinct situations (8 and 9 texts). One code per situation
would be cleaner, but codes are a public contract and adding thirteen exceeds the scope.
`ParamsOf<C>` is therefore a **discriminated union** on `reason` for these two codes, and the
rendering branches on it. The discriminant is documented: it is part of the contract just like the
code.

**D2 — library text goes into `params`, it is not rewritten.** `INVALID_YAML` carries `{ detail }`,
the sentence from the `yaml` library; `INVALID_OPERATION` with `reason: "schema"` carries
`{ path, detail }`, zod's. Both are already in English. The module **frames** them without
rewriting them: rewriting YAML parse errors by hand would lose precision to gain a superficial
uniformity.

**D3 — the CLI chrome stays in the CLI, in English.** Usage, help, command descriptions, "no
diagnostics": these texts carry no code and are consumed by no one else. Putting them in the
registry would mean inventing codes for help lines. They are translated in place. The rule "no
string outside the module" applies to everything that **carries a code**.

**D4 — the server's six transport codes enter the registry.** Otherwise the UI cannot render them,
and the "every code has a message" test would have its hole exactly where the French was. They
become exported constants and `specs/diagnostics.md` gains a third table.

**D5 — the deduplication in `resolve.ts` is on `code` + `params`.** It compared `code` + `message`.
With `params`, the comparison is done on a stable serialisation with sorted keys. Without this, two
different missing `extends` targets would be conflated, or worse, two identical diagnostics would
appear twice.

**D6 — `params` is always present.** `Diagnostic` becomes `{ code, severity, range, params }`,
`OperationError` becomes `{ code, params }`. No optional: a field absent half the time reads as
optional data, whereas `params` is the contract. Codes without data carry `Record<string, never>`.

**D7 — the module's test lives in `packages/core/test/`, not in `src/`.** The requested tree places
it in `src/messages/`, which the **Node runtime constraint** of `CLAUDE.md` forbids: `core`'s
`tsconfig.json` only includes `src/` with `"types": ["node"]`, so `bun:test` does not compile there,
and `scripts/check-runtime.ts` fails on any `bun:*` import in a runtime package's `src/`. The file
therefore goes in `packages/core/test/messages.test.ts`, with the other `core` tests. This is the
only divergence from the requested tree.

## Target tree

```
packages/core/src/messages/
  codes.ts     MessageCode + ParamsOf<C>, discriminated union where D1 requires it
  en.ts        Record<MessageCode, (p) => string>, exhaustiveness guaranteed at compile time
  index.ts     render(code, params) — exported as @keelson/core/messages
packages/core/test/messages.test.ts    (D7)
```

`packages/core/package.json` gains the `"./messages"` export, `tsconfig.base.json` the
`@keelson/core/messages` path.

## Test plan

1. **Exhaustiveness, in both directions** (`core/test/messages.test.ts`): the set of keys of
   `en.ts`, that of `MESSAGE_CODES` and that of the codes listed in `specs/diagnostics.md` are
   **equal**. Three comparisons, not an inclusion. A code added without a message, a message
   without a code, an undocumented code: three distinct failures, with the code's name in the
   failure message.
2. **Every rendering is exercised** with representative `params`: no output contains `undefined`,
   `null`, `[object Object]`, template leftovers (`${`, `{{`), or a French character
   (`éèêàçùûôîâœ«»`). Discriminated unions are covered **branch by branch**: the test enumerates the
   `reason`s and fails if one is not exercised.
3. **`core` and adapters**: existing tests that assert on `message` switch to `code` + `params`. A
   test checks that no diagnostic or error returned by `parse`, `validate` and `apply` carries a
   `message` or `details` key. The deduplication of D5 is tested on two different missing
   `extends` targets in the same file.
4. **CLI**: `keelson validate` renders the English text from `render()` for each diagnostic family;
   `--format json` exposes `code`, `params` **and** the rendered `message` — the JSON is consumed by
   scripts, which need both.
5. **Server**: for **every error path** — the six transport ones, the three envelope ones, the
   `parseOperation` relay, the `apply` relay, the 409 with `hash` — a test checks the exact shape of
   the body and **the absence of a `message` key**. The double hash computation is covered by a
   test that counts the calls to `hashText` on one request.
6. **UI**: `ErrorBanner` is tested **on the rendered DOM** with `JOB_REFERENCED` — the English
   sentence rendered by `render()` and each of the referrers must be visible. Same for a code
   without `params`. `referencedBy()` reads `params.referencedBy`.
7. **E2E on the real binary**: a 409… — actually a **422** `JOB_REFERENCED`, 409 being reserved for
   `STALE_DOCUMENT` (`store.ts:189`); the milestone brief says "a 409 `JOB_REFERENCED`", which the
   server cannot produce. The test therefore forces the real path: delete a job that another one
   needs, and check that the banner shows the English sentence and the referrers.

Every fix and every invariant is **checked red by reintroducing the real defect**, without
`git stash`: the file is restored by rewriting it and `git diff` checked empty.

## Definition of done

- `bun install --frozen-lockfile`, then `bun run check` from a tree **without any `dist/`**, then
  `bun run e2e`, then the built binary run under `node`.
- No French message in `packages/*/src` outside comments, checked by `grep`.
- `specs/diagnostics.md` documents the `params` of every code, server transport included.
- `specs/gaps.md` up to date: addressed gaps closed with their proof, new gaps added.
- ADR 0002 carries its completed scope line, and the 2026-10-22 gap that motivated it is closed.
- Log in `specs/progress.md`, `--no-ff` merge into `main`, `bun run check` green on `main`.
