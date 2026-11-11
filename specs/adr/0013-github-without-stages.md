# ADR 0013 — GitHub Actions has no stages: they are derived

**Status**: accepted, 2026-11-05.

## Context

The IR and the Pipeline view are organized in stages. A workflow has none: order comes from
`needs`. One job per workflow and a graph without columns would require a second view, and a new
field everywhere the IR says `stage`.

## Decision

The adapter derives implicit stages: `level 1` for jobs without `needs`, then one level above the
highest of a job's dependencies. None of this exists in the file. `Pipeline.provider` is `github`,
and the UI removes what makes no sense: stage controls, a job's stage, a need's `optional` and
`artifacts`. `addStage`, `moveStage` and `setJobStage` are refused with
`INVALID_OPERATION notForProvider`, like a need with options.

A `uses:` job calls a reusable workflow that Keelson does not read: `WORKFLOW_UNRESOLVED`, and
`Pipeline.unresolved` counts it, so coverage is a lower bound.

## Consequences

Each workflow is a document: a repository has several, and the workspace lists them all. The GitLab
goldens do not change; `provider` is absent from them.
