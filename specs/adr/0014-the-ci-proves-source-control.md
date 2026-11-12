# ADR 0014 — The CI that runs the jobs proves source control

**Status**: accepted, 2026-11-12.

## Context

ADR 0011 lets a declared service cover a platform category. Source control stayed "not seen" on
every repository without a toolchain, although Keelson reads it from a CI file: `--require scm`
failed unless a service was declared.

## Decision

A job proves source control. Only a forge runs its own CI: a GitLab CI file runs on GitLab, a
workflow of `.github/workflows` on GitHub or on a forge that reads that directory (Gitea and Forgejo
do). The result names the CI system (`gitlab-ci`, `github-actions`) in `LayerCoverage.ci`, not a
forge: the format is what Keelson sees, the host is not. The system follows each job's file, as the
server picks the adapter, so a repository with both kinds names both. No other layer is proven this
way, and a pipeline without jobs proves nothing.

## Consequences

`keelson coverage --require scm` passes on any repository whose CI has a job. The CLI, the coverage
panel and the Markdown export print `ci gitlab-ci` or `ci github-actions` beside the jobs and
services. A declared GitLab or Gitea service still names the forge itself.
