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

A `uses:` job calls a reusable workflow. A remote one (`owner/repo/…@ref`) is not read:
`WORKFLOW_UNRESOLVED`, and `Pipeline.unresolved` counts it, so coverage is a lower bound.

*Amended 2026-11-11.* A local one (`./.github/workflows/x.yml`) is read through the same bounded
reader as GitLab's `include: local`, and the signals of its jobs become those of the calling job:
the caller stays **one** node, whose coverage is what the called jobs run. Its jobs are not added to
the IR: they belong to another file, which an edit of this one must not touch, and their ids may
collide with the caller's. The called file is listed in `Pipeline.files` and its text in
`included`, so the server watches it. A call GitHub would refuse — missing file, path outside the
root or outside `.github/workflows`, cycle, more than 10 levels or 50 unique workflows — is a
`WORKFLOW_CALL_INVALID` error, and the pipeline stays partial. A local action (`uses: ./path`) is
read the same way, `action.yml` then `action.yaml`: the steps of a composite action and the image
of a Docker action count for the job. A missing one is silent, since it may come from a checkout
made at run time.

`strategy.matrix` is not expanded into jobs: a matrix is one key in the file, and one key must stay
one node for edits to stay in place; layer coverage does not depend on how many copies run. Its literal values are substituted into
`run` lines and into `container` for detection only — `${{ matrix.tool }} scan` with `tool:
[trivy, grype]` reads as both commands — capped at 64 variants per line. A matrix computed by an
expression has no values to substitute.

## Consequences

Each workflow is a document: a repository has several, and the workspace lists them all. The GitLab
goldens do not change; `provider` is absent from them.
