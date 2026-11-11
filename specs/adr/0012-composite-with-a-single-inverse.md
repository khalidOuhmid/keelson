# ADR 0012 — A composite operation has a single inverse

**Status**: accepted, 2026-11-05.

## Context

Inserting a tool may require a stage and a job. Two operations would mean two undo steps, and a
failure of the second would leave the first written.

## Decision

`composite` applies its steps in memory, in order, and writes only if all of them succeed. The
inverse and `touched` are computed on the final text: the range runs from the first to the last
differing byte. Allowed steps are limited to those that add: `addStage`, `addJob`, `addNeed`,
`addSnippet`.

## Consequences

A composite touches a single range, sometimes a wide one: a stage at the top and a job at the end of
the file span the middle, which stays byte-for-byte identical. The UI diff is therefore computed by
lines, not from `touched`.
