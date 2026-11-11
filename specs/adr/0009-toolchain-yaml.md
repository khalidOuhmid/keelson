# ADR 0009 — `.devsecops/toolchain.yaml` is edited by in-place patches

**Status**: accepted, 2026-11-04.

## Context

The file belongs to Keelson, but it is reviewed as a diff and fixed by hand: it is where the user
confirms an inference. Rewriting it entirely would lose comments and ordering.

## Decision

The file is read with `yaml` and written through range replacements, like native CI. Each operation
returns an inverse `splice`. `services` is a map: the identifier is the key, so uniqueness comes from
the format. A non-empty flow-style section is refused with `INVALID_OPERATION`.

## Consequences

The four `adapter-gitlab` properties apply as is. A missing file counts as an empty toolchain: the
first operation creates it, and its inverse leaves it empty, without deleting it.
