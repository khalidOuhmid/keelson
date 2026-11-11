# ADR 0007 — What downgrades a missing `extends` target

Date: 2026-11-04 · Decided by: Khalid · Status: accepted

## Context

Since the end of L2b, `Pipeline.unresolved` has two families: includes that cannot be read (remote
forms, `local` without a reader) and broken `include: local`. It answers the screen's question:
what is missing from the displayed pipeline? The severity of `EXTENDS_TARGET_NOT_FOUND` also
depended on it, so a misspelled include path downgraded an error to a warning. Yet milestone L2b
asked to downgrade only when an unresolved remote include could explain the absence.

## Decision

Severity follows the first family only. A broken local include leaves `error`, because nothing in
it is unknown: its cause is an `INCLUDE_NOT_FOUND` error, and once that is fixed the diagnostic
disappears or becomes accurate. A remote include, or a `local` that was not looked up, leaves
`warning`, because the target may really be there.

A short-form URL (`include: 'https://…'`) is a remote include, not a broken local path. What the
150-file limit cuts off has not been read: it counts in the first family.

## Consequences

- A pipeline can be partial (`isPartial`) and still return `error`: the two answer two different
  questions, and `Pipeline.unresolved` no longer decides severity.
- A single misspelled path can produce two related errors. This is accepted: each one is true.
