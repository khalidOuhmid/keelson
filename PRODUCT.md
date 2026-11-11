# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**The deciding user: the DevSecOps / platform engineer.** They design or evolve the CI chain and
the platform services (Nexus, Harbor, DefectDojo, Vault, Sentry…) for several teams. They know CI
YAML, edit it daily, and open Keelson **in a repository they have at hand**, locally, to see the
pipeline, complete it and write the configuration without losing what exists. When the needs of the
profiles diverge (editing density versus legibility of a finding), their usage wins.

Three confirmed secondary audiences:

- **Security architect / CISO**: audits the OWASP coverage of an existing repository, produces a
  finding, enforces required layers (`keelson coverage --require`). Mostly consumes the overlay and
  the report, edits little.
- **Dev lead of a product team**: opens their own repository to understand and fix their pipeline
  without being a CI expert. Needs every proposal to be justified and verifiable.
- **Consultant on assignment**: works on N client repositories, wants a reusable model and a
  report; eventually applies the same series of operations to a fleet (milestone L8).

## Product Purpose

Visually design a DevSecOps chain **before** implementing it, while staying connected to the
repository's real files. Today, design happens either in a diagramming tool disconnected from the
code, or directly in the YAML where the big picture is lost; in both cases, nobody can say which
security layers are actually covered or what is missing.

Keelson reads and rewrites native CI YAML (GitLab CI first, GitHub Actions next), models alongside
it the platform services and their integrations with jobs, projects coverage of the 13 layers of the
OWASP DevSecOps Guideline plus platform categories outside OWASP, and suggests, from a catalogue of
50 to 100 tools, implementations for uncovered layers.

Success: for a given repository, the user knows what is covered, by what, what is not, and leaves
with configuration written into their files, without a single comment, key order or anchor having
moved.

Permanently out of scope: Keelson deploys nothing, runs no pipeline, scans no code. It designs,
documents and writes configuration.

## Positioning

**The repository is the source of truth, not Keelson.** No proprietary format replaces CI YAML.
Keelson owns only two files, `.devsecops/toolchain.yaml` (services and integrations, which cannot be
inferred from CI) and `.devsecops/layout.json` (node positions, layer overrides).

What a neighbouring tool cannot copy without changing its nature:

- **Byte-for-byte round-trip.** A parse then emit with no modification produces an identical file:
  comments, key order and anchors preserved. Editing by in-place patch, never by regeneration.
  Verified by a corpus of 34 files and four fast-check properties (round-trip, inverse,
  determinism, locality).
- **What the model does not understand is kept as is** in opaque blocks, never rebuilt.
- **Nothing is prescribed without justification.** Every tool proposal points to the OWASP layer it
  covers, with its licence and a verifiable snippet.
- **Local first.** No remote service, no account: `npx keelson start` and that is all.

## Operating Context

- **Launch**: `npx keelson start` from the root of a repository opens a local web UI (Node ≥ 20,
  no Bun). The other commands are command-line: `validate`, `coverage`, `export`, `catalog lint`,
  and later `apply ops.json`.
- **Materials handled**: the repository's `.gitlab-ci.yml` (then GitHub Actions workflows), the
  `include` and `extends` templates (resolved read-only for display, never rewritten),
  `.devsecops/toolchain.yaml`, `.devsecops/layout.json`.
- **Reference frameworks**: the 13 layers of the OWASP DevSecOps Guideline (git secrets, SCA, SAST,
  IaC, supply chain, IAST, API security, DAST, CNAPP, infrastructure scanning, continuous scanning,
  compliance, AI/LLM security) and eight platform categories outside OWASP (SCM, artifact
  repositories and registries, secrets management, vulnerability aggregation, server-side code
  quality, runtime observability, runtime security, policy-as-code).
- **Rituals**: design ahead of an implementation, audit of an existing repository, running
  `keelson coverage --require` in CI as a guardrail. Changes are reviewed by the user as a git diff
  before committing: the diff must stay minimal and readable.
- **Planned views**: Pipeline (stages, jobs, dependencies), Toolchain (services and integrations),
  OWASP overlay (projected coverage, "not covered" panel and proposals), Catalogue (tools filterable
  by layer and licence).

## Capabilities and Constraints

**Shipped (milestone L1)**: pipeline IR, GitLab CI adapter with validated round-trip, serialisable
and invertible edit operations, `keelson validate` in text and JSON.

**In progress (milestone L2)**: the Pipeline view in the UI, read then edit. Planned dependencies
not yet installed: `@xyflow/react` for graphs, CodeMirror 6 for opaque YAML blocks, Zustand for
state.

**Shipped in milestone L3**: taxonomy, catalogue of 62 tools, Coverage and Catalog views,
`keelson coverage` and `keelson catalog lint`.

**Shipped in milestone L4**: `.devsecops/toolchain.yaml` edited through operations, integration
inference confirmed or dismissed, free-positioned Toolchain view.

**Shipped in milestone L5**: inserting a catalogue tool with a diff preview, undone in one step,
`keelson export`.

**Shipped in milestone L6**: GitHub Actions, workflows read and written like GitLab CI, stages
derived from `needs`.

**Not yet shipped**: npm packaging (L7), fleet (L8). Nothing is usable by an end user to date.

**Model terminology** (code names, to be translated in the UI): `Pipeline`, `Stage`, `Job`,
`Need` (dependency between jobs, with `optional` and `artifacts`), `Environment`, `Template` (key
starting with `.`), `OpaqueBlock` (kept byte for byte). Every value of a job carries an `Origin`:
`local`, `default`, `extends`, `anchor` or `reference`, which says where it comes from and therefore
whether it is editable here. On the toolchain side: `Service` (named instance: name, tool type, URL,
environment) and `Integration` (`push`, `upload-report`, `fetch-secret`, `notify`). On the taxonomy
side: `Layer` with `source: owasp | platform`. On the catalogue side: `Tool` with covered layers,
licence, logo, detection patterns, snippets, `lastVerified`.

**Two families of feedback**: **diagnostics** (`Diagnostic`, with severity `error` / `warning` /
`info` and a range in the file) describe the state of a file and block nothing; **operation errors**
(`OperationError`, no severity) refuse an edit and guarantee that no change is written. The codes are
public contracts documented in `specs/diagnostics.md`.

**Every edit is an operation**: a plain JSON object, versioned (`v: 1`), anchored on a `baseHash` of
the source text; `apply` rejects a stale hash (`STALE_DOCUMENT`). Each application returns an
`inverse`. The UI must therefore naturally expose undo/redo and detect a file modified outside
Keelson.

**Lasting technical constraints**:

- The UI runs locally on a fixed port (5283 today, configurable planned for L2).
- `include`s are not resolved in L1: a displayed pipeline may be partial, and the UI must say so
  rather than hide it.
- Packages that run on the user's machine use no Bun API.
- Design and front end: React 19, Vite, Tailwind CSS v4, Biome. Component tests with Testing
  Library and happy-dom, E2E with Playwright. Strict TDD, no untested code.

**UI language**: **English by default, with strings externalised from milestone L2** so that French
can be added later. Specs, code, comments and tests are written in English. The diagnostics rendered
by `core` were in French when this was first written; their consistency with an English UI was left
**to settle in L2**, not decided here.

## Brand Commitments

- **Name**: Keelson (the longitudinal timber laid on the keel that holds the ship's structure
  together). No logo, no brand guidelines, no fixed palette or typography. The nautical metaphor is
  not a commitment: it was not retained as a constraint.
- **Licence**: Apache-2.0, Copyright 2026 Khalid Ouhmid. Open source, no known commercial edition.
- **Voice** (inferred from the specs, not yet confirmed for the UI): factual, precise, no
  marketing; every proposal is justified and sourced.
- **Visual world: the category standard, played straight.** Decided in milestone L2 (2026-10-21),
  after a round of directions in which the exit was taken explicitly. Keelson looks like what its
  audience already opens: stage columns, job cards, dependency edges, interface sans-serif, dark
  theme by default. **No irony, no smuggled-in quirkiness**: the convention is the commitment, not a
  compromise. The directions dismissed in that round (normative specification sheet with revision
  bars, electrical wiring diagram, high-density Japanese grid, night transit map) are not to be
  brought back in through the window.
- **Finish bar: Linear, Vercel, Raycast.** Their *quality of execution* is the target, never their
  layout: very finely stepped greys, one-pixel borders, a single accent, high density without
  clutter, crafted hover and focus states, first-class keyboard support. A Keelson screen less
  polished than those products is not finished.

## Evidence on Hand

- **Real corpus**: 20 official GitLab CI templates under the MIT licence
  (`packages/adapter-gitlab/test/corpus/gitlab-templates/`, provenance in `LICENSES.md`) and 14
  in-house fixtures (`edge-cases/`), with IR goldens. These are the only pipeline examples usable for
  demos or UI states. **Never add a CI file coming from an employer or a client.**
- **Tool logos**: none embedded to date. Future rule: Simple Icons (CC0) first, a vendor logo only if
  its brand guidelines explicitly allow it, otherwise the layer's generic icon.
- **Absences not to fabricate**: no users, testimonials, adoption figures, case studies,
  screenshots or benchmarks. The project is under development and the README says so.

## Product Principles

1. **The user's file first.** Every interaction is judged by the diff it produces: minimal, local,
   reviewable. What Keelson does not understand, it shows as is and never rebuilds.
2. **Say where everything comes from.** A value inherited from an `extends`, an anchor or a default
   is not a local value: origin is first-class information, and it determines what is editable.
3. **Show uncertainty rather than hide it.** Partial pipeline, unresolved include, warning
   diagnostic, file modified outside the tool: the real state is always visible.
4. **Justify before prescribing.** A missing layer points to the Guideline; a proposed tool points
   to its layer, its licence and a verifiable snippet. Never a bare recommendation.
5. **Expert density, audit legibility.** The platform engineer edits fast and without friction; the
   finding that comes out must stay legible to a CISO or a dev lead who does not know CI.

## Accessibility & Inclusion

**WCAG 2.1 AA required**: contrast, full keyboard navigation, screen readers, touch targets. The
graphs (pipeline, toolchain, overlay) must have a keyboard-navigable, screen-reader-readable
equivalent, not just a visual representation.
