# ADR 0010 — Inference proposes, the file decides

**Status**: accepted, 2026-11-04.

## Context

The plan calls for integrations inferred from scripts, then confirmed or corrected. An inference
written automatically would make Keelson the author of claims it cannot verify.

## Decision

A `service` catalogue entry carries an `integration` field: one kind per tool. Inference computes
`(job, tool, kind)` triples and never writes them. A triple is confirmed if `integrations` links that
job to a service of that tool with that kind, dismissed if it appears in `dismissed`, proposed
otherwise. `dismissed` exists because a false positive would come back on every analysis.

## Consequences

Detection keeps its limits (`specs/gaps.md`) without ever corrupting the file. A multi-purpose tool
proposes only one kind; the user writes the others by hand.
