# ADR 0011 — A declared service covers its tool's layers

**Status**: accepted, 2026-11-04.

## Context

Platform categories live around the pipeline: no job proves a Nexus or a GitLab. L3 therefore
reported them as "not seen" even when the team operates them.

## Decision

`coverage` receives the toolchain's services. A layer is covered by a detected job or by a declared
service whose tool carries it, and the result names both. Declaring a service remains a claim made
by the user, and the panel says that it comes from the toolchain.

## Consequences

`keelson coverage --require scm` becomes satisfiable. A service declared for an OWASP layer (Wiz,
DefectDojo) covers it too: it is a statement of presence, not of use.
