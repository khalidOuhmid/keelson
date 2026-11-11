# ADR 0002 — Language and messages

Date: 2026-10-22 · Decided by: Khalid Ouhmid · Status: accepted

> **Status: amended on 2026-11-11** — all documentation, specs and code comments are now written in
> English; the rule that the product, CLI and wire messages are English-only stands.

## Context

The diagnostic messages in `core` and those of the CLI are in French, while the UI has been in
English since milestone L2. The diagnostics panel therefore shows French inside an English
interface, and `PRODUCT.md` explicitly left this point open.

Two gaps already recorded it (`specs/gaps.md`, 2026-10-21). Milestone L3 will produce
**hundreds** of additional messages — OWASP coverage, catalogue validation, `catalog lint` — and
milestone L7 planned to deal with language at packaging time. Deciding after L3 would mean going
back over everything L3 produced.

A structural constraint already exists in the project: diagnostic codes and operation error codes
are **public contracts**, documented in `specs/diagnostics.md` and checked by
`packages/core/test/diagnostics.contract.test.ts`. The text itself has never been a contract.

## Options

1. **Translate the existing messages to English, in place.** The cheapest in the short term, but
   free text is still produced by `core`: the display layer can neither rephrase it, enrich it, nor
   localize it later without redoing the work.
2. **Set up a full translation infrastructure now.** High immediate cost for a need nobody has
   expressed, on a project with no users to date.
3. **Separate the contract from its rendering**: `core` only returns `code` and `params`, a single
   module renders them as English text, and language infrastructure is added only if a real need
   arises.

## Decision

Option 3.

- **Single product language: English.** UI, CLI, diagnostics, catalogue, user-facing
  documentation. Specs, code and tests stay in French.
- **`core` and the adapters never produce free text.** Every diagnostic and every error carries a
  stable `code` and structured, typed `params`.
- **A single module, `@keelson/core/messages`,** turns `(code, params)` into English text. The CLI
  and the UI both use it: one wording per code, across the whole product.
- **A test fails** if a code in `specs/diagnostics.md` has no message, or if a message has no code.
  It extends the existing contract test, which until now only checked that the code was present in
  the documentation.
- `details` is removed and merged into `params`: a diagnostic or an error carries only `code`,
  `severity` (for diagnostics), `range` (when applicable) and `params`. `JOB_REFERENCED` exposes
  `params.referencedBy`.
- **No translation infrastructure** until a real need is expressed.

## Consequences

- **A dedicated milestone, `L2c — messages`,** is inserted **after L2 is merged and before L3**.
  The milestone order becomes: L2, L2c, L2b, L3, L4, L5, L6, L7, L8.
- The two language gaps of 2026-10-21 are **closed by this ADR**.
- The "handle the language gap" item of milestone **L7 becomes moot** and is removed from it.
- `params` becomes part of the public contract just like the code: changing its shape is a breaking
  change, just like renaming a code. `specs/diagnostics.md` must document the `params` of each
  code, not only its meaning.
- The UI still applies **no per-code handling**: it displays what the messages module returns. The
  only exception remains `JOB_REFERENCED`, whose `params.referencedBy` it now reads to list the
  referencing jobs.
- Removing `details` is a **breaking change**, and a deliberate one: no version has been published,
  so this is the moment it costs nothing. It affects `OperationError` in
  `packages/core/src/operations.ts`, the server API's error shape, `ApiFailure` in
  `packages/ui/src/api/client.ts`, and `referencedBy()` in `packages/ui/src/editing/drafts.ts`.
- Side benefit for milestone L8: a remote client that receives `code` and `params` can phrase its
  own message without parsing a string.

Scope extended on 2026-10-22: `@keelson/server`, see the gap of the same day.
