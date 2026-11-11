# Autonomous autopilot — milestones L3 to L8 (archived)

> Archived on 2026-11-11: brief of the autonomous agent that delivered L3 to L8, kept as a record of
> the process (TDD, read-only independent review, ADRs). It is no longer active: the project status
> is in [progress.md](progress.md). The `lot/<id>-<name>` branches below are the historical names;
> milestone branches are now named `milestone/<id>-<slug>`.

This file is the agent's complete brief until the end of the project. It is reread at every session. The resume state lives in `specs/progress.md`, never in the conversation.

## Session start
1. Read `specs/progress.md` and resume at its "Next action". Check that the state it describes matches the repository (branch, latest commits, `bun run check` green); if they diverge, the repository wins and the divergence goes into the log.
2. Read `CLAUDE.md`, `PRODUCT.md`, `DESIGN.md`, `specs/01-plan.md`, `specs/diagnostics.md`, `specs/gaps.md` and every file in `specs/adr/`. All their rules apply, without exception: strict TDD, dated debt, recorded gaps, no hard-coded value outside `tokens.css`, render test boundary, `code` + `params` only (ADR 0002), ADR 0003 and 0004, read-only independent review, no Bun API in runtime packages, determinism.
3. Never run `claude` from the shell. Ask for no approval.

## Loop per milestone
1. **Scoping**: branch `lot/<id>-<name>` from `main`; `specs/milestones/<id>.md` written from the actual code (target tree, API or routes, test tree, definition of done); `docs:` commit.
2. **Implementation** in TDD, one commit per green step. Every invariant test is proven red by temporarily reintroducing the defect, then the file is restored and `git diff` is checked empty on that file. Never `git stash` or `git checkout-index` for this check. Before regenerating a golden, reread the golden's diff: a regeneration never blesses a regression.
3. **Independent review**, by a subagent that has not seen the implementation, strictly read-only (a temporary `git worktree` for experiments). Commits that fix its findings get a counter-review, by another subagent, before the merge. It rereads the diff against `specs/milestones/<id>.md`, and looks first for tests that cannot fail and for comments that promise more than the test checks. Fixes follow ADR 0003.
4. **Verification**: `bun install --frozen-lockfile && bun run check && bun run e2e` from a tree with no `dist/` at all, Node smoke test of the built binary, definition of done checked item by item.
5. **Integration**: `git checkout main && git merge --no-ff lot/<id>-<name>`, `bun run check` on `main`.
6. **Tracking**: `progress.md` updated (milestone done, next action, log), commit on `main`, then the next milestone without waiting.

## Decisions
- Reversible (technical, structure, naming, format, UI behaviour): decide alone, at the level of a demanding architecture review, and record it in `specs/adr/NNNN-title.md` at the next free number.
- Irreversible or external (`npm publish`, remote repository, push, rewriting `main`'s history, a file whose licence forbids redistribution): never. Prepare everything, then `Status: BLOCKED` in `progress.md` with the exact commands expected.
- Third-party data: licence verified from the source and provenance recorded before any copy. Logos through the `simple-icons` npm package (CC0) as a devDependency; a vendor logo only if its brand guidelines explicitly allow it; otherwise the layer's generic icon.
- Front end: `/impeccable shape` before any new surface, `critique` then `audit` after, `polish` at the end of the milestone, `document` as soon as the tokens change.

## Context management
Never stop on your own: automatic context compaction handles the session length

## Milestones, in this order

### L3 — taxonomy, catalogue, OWASP overlay
- `@keelson/taxonomy`: the 13 layers of the OWASP DevSecOps Guideline (git secrets, SCA, SAST, IaC, supply chain, IAST, API security, DAST, CNAPP, infrastructure scanning, continuous scanning, compliance, AI/LLM security) and the platform categories (SCM, artifact repositories and registries, secrets, vulnerability aggregation, server-side code quality, runtime observability, runtime security, policy-as-code), each with `source: owasp | platform`. Cited source: https://github.com/OWASP/DevSecOpsGuideline.
- `@keelson/catalog`: 50 to 100 tools, one YAML per tool validated by zod (`id`, `name`, `kind: job | service`, `layers`, `license`, `homepage`, `logo`, `detect`, `snippets.gitlab`, `snippets.github`, `lastVerified`). At least two tools per OWASP layer, one of them open source; mandatory: DefectDojo, Dependency-Track, Nexus, Harbor, Artifactory, Vault, SonarQube, Sentry, Falco. Each catalogue entry verified on the official site, with the verification URL in the entry.
- Per-job layer detection through `detect` (on `image` and `script`), overridable in `.devsecops/layout.json`.
- UI: overlay colouring jobs by layer, "uncovered layers" panel, Catalog view (layer, licence and adapter filters), tool page.
- CLI: `keelson coverage [--require <layers>] [--format json]` (exit code 1 if a required layer is missing); `keelson catalog lint` (schema, logos, `lastVerified` > 6 months).
- The gaps already attached to L3 in `specs/gaps.md` are handled and closed with evidence.

### L4 — toolchain
`.devsecops/toolchain.yaml`: services as named instances (name, catalogue tool, URL, environment) and job → service integrations (`push`, `upload-report`, `fetch-secret`, `notify`). Integrations inferred from scripts through the catalogue, confirmed or corrected in the file. Round-trip of the file through operations, with the four fast-check properties. Toolchain view with free positions persisted in `.devsecops/layout.json`. `keelson validate` covers the toolchain.

### L5 — proposals and insertion
From an uncovered layer: list of catalogue tools, preview of the YAML diff, job insertion through a composite operation with a single inverse. `keelson export` to documented formats, at least Mermaid and a Markdown coverage report.

### L6 — GitHub Actions adapter
`.github/workflows/*.yml` to the IR and back: same operations, same properties, corpus under a verified licence (pinned SHA, notice reproduced), detection in the workspace, `github` snippets of the catalogue used. `include` does not exist here; `uses` of reusable workflows are reported as unresolved with a dedicated code.

### L7 — open source packaging
Complete README with screenshots, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue and PR templates, release workflow (changelog, semantic versioning), `npm pack` verified with a clean install on Node 20 and 22. Do not publish: `BLOCKED` with the exact list of commands.

### L8 — fleet
`keelson apply ops.json` (serialized operations on a repository, dry run by default, writing behind an option). `keelson fleet coverage <manifest>`: aggregated coverage of N local repositories, cache by file hash, incremental update, JSON and Markdown output.

## End
When L8 is merged: `Status: DONE` in `progress.md`, and a final report: merged milestones, ADRs created, most structural gaps, pending publication commands.
