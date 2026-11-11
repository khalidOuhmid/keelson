# ADR 0005 — The included-file reader is synchronous

Date: 2026-10-23 · Decided by: the autopilot · Status: accepted

## Context

Resolving `include: local` forces `parse` to read files other than the one it is given. `parse` is
today a pure `text → IR` function, synchronous, and `apply` calls it twice per operation to get the
IR before and after.

Packages that run on the user's machine may not use any Bun-specific API (`CLAUDE.md`), but
`node:fs` is allowed — the CLI and the server already use it.

## Options

**A. Make `parse` asynchronous.** That is the natural shape of a disk read in Node. It contaminates
`apply`, hence the whole editing chain, hence `planFor` and the ten `plan*` functions, for zero
gain: included files are few, small, and already in the file system cache when the server reads
them again. It would also make `apply` reentrant in a way the server's per-document queue would
have to absorb.

**B. Pre-read the included files before `parse`.** Impossible: knowing *which* files to read
requires having resolved the include graph, that is, having parsed each file to find its own
`include` key. You cannot pre-read what you discover by reading.

**C. Inject a synchronous reader.** `parse(text, { file, read })` where `read` is a two-method
interface, `read(path)` and `candidates()`. The adapter knows nothing about the disk; the caller
provides the implementation.

## Decision

**C.** The reader is an injected synchronous interface, and its `node:fs` implementation lives in
`packages/adapter-gitlab/src/reader.ts`, shared by the CLI and the server.

## Consequences

- `parse` stays synchronous, so does `apply`, so nothing in the editing chain changes shape.
- The resolution module is tested against an **object literal** — an in-memory repository — so
  without a disk, and no test can pass because a file happens to be lying around.
- The server pays one blocking read per included file per load. This is accepted: it serves a
  single user on their own machine, and the cost is that of a `readFileSync` on an already-hot file
  of a few kilobytes.
- A single implementation holds the repository's **root boundary**. This is deliberate: two copies
  of that boundary would be two places to lose it. It is checked twice — once on the normalized
  path before any read, once on the resolved path just before `readFileSync` — because it is the
  last line before a local server reads the disk on behalf of a web page open in the user's browser.
- `GitlabDocument` carries `file` and `read`, which is what it takes to **reparse the same
  pipeline**. Without them, `apply` would reread the text without its `include`s: the cycle guard
  and the refusal to edit an included file would then apply to a truncated pipeline.
- If remote `include`s are ever resolved — a later milestone — reading them is a network request
  and this decision will no longer hold as is. The disk cache they will require must be filled
  **outside** `parse`, and the synchronous reader will read that cache.
