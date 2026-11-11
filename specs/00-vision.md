# Keelson — vision

## The problem

Today, a DevSecOps chain is designed either in a diagramming tool disconnected from the code, or
directly in the CI YAML, where the big picture gets lost. Either way, nobody can say which security
layers are actually covered, or what is missing.

## The proposal

Keelson is an open source tool (Apache-2.0, author: Khalid Ouhmid) for visually designing a
DevSecOps chain before implementing it, while staying wired to the repository's real files:

- **The CI pipeline, round-tripped with native YAML.** GitLab CI first, GitHub Actions next. The
  repository's YAML is the source of truth: Keelson reads it, displays it, and edits it with in-place
  patches. A parse followed by an emit with no change must produce identical bytes — comments, key
  order and anchors preserved.
- **The platform services around the pipeline.** Nexus, Harbor, DefectDojo, Vault, Sentry… as named
  instances, with their integrations with the pipeline's jobs (artifact push, report upload, secret
  fetch, notification).
- **A coverage overlay.** The 13 layers of the OWASP DevSecOps Guideline, plus platform categories
  outside OWASP, projected onto the pipeline and the toolchain: what is covered, by what, and what
  is not.
- **A catalogue of 50 to 100 tools.** Logos, licences, detection patterns and ready-to-insert
  snippets, offering concrete implementations for the uncovered layers.

## End usage

```sh
npx keelson start          # opens a local web UI in the current repository
keelson validate           # validates the pipeline and the toolchain
keelson coverage           # reports coverage, non-zero exit if a required layer is missing
keelson export             # exports the model
```

## Principles

- **The repository is the source of truth, not Keelson.** Keelson introduces no proprietary format
  that would replace the CI YAML. The only two files it owns are `.devsecops/toolchain.yaml` (the
  services and integrations, which cannot be derived from the CI) and `.devsecops/layout.json` (node
  positions, layer overrides).
- **Local first.** No remote service, no account. `npx keelson start`, and that's it.
- **The round-trip is non-negotiable.** A tool that rewrites the YAML and loses the comments is a
  tool nobody uses twice.
- **What the IR does not model is kept as is** in opaque blocks, never rebuilt.
- **Prescribe nothing without a reason.** Every tool proposal points to the OWASP layer it covers,
  with its licence and a verifiable snippet.

## Out of scope

Keelson deploys nothing, runs no pipeline, and scans no code. It designs, documents and writes
configuration.

Milestone breakdown and technical detail: [01-plan.md](01-plan.md).
