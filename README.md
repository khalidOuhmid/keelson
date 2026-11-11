# Keelson

**Design your DevSecOps chain visually, on top of the CI files you already have.**

Keelson reads your native CI YAML, draws the pipeline, projects the 13 layers of the
[OWASP DevSecOps Guideline](https://owasp.org/www-project-devsecops-guideline/) onto it, models the
platform services around it (Vault, Harbor, DefectDojo, Nexus, Sentry…), and proposes concrete,
catalogued tools for every layer you do not cover yet. Then it writes the change back into your
YAML — in place, byte for byte, comments and anchors preserved.

```sh
npx keelson start
```

Runs locally on Node ≥ 20. Nothing leaves your machine. Apache-2.0.

**Demo (1 min 54):** [docs/demo/keelson-demo.mp4](docs/demo/keelson-demo.mp4) — pipeline, OWASP
coverage, closing a gap from the catalogue, toolchain, GitHub Actions, CI gate and fleet apply.

## Why

Platform teams design security chains in diagram tools that drift from the code, or directly in YAML
where the big picture is lost. Neither answers the question an architecture review actually asks:
*which security layers does this pipeline cover, with what, and what is missing?*

Keelson answers it from the repository itself, keeps the repository as the source of truth, and
scales the answer to a fleet of repositories.

## What it does

| | |
| --- | --- |
| **Pipeline view** | Stages, jobs and `needs` from `.gitlab-ci.yml` (local `include`, `extends`, anchors resolved) and from `.github/workflows/*.yml` (jobs laid out by dependency level). |
| **Lossless round-trip** | GitLab CI edits are patches on the original bytes. Parse → emit with no change is byte-identical; every edit returns a `splice` inverse. Verified by property tests over 34 real-world files, including 20 official GitLab templates. |
| **Coverage overlay** | 13 OWASP DevSecOps layers plus 8 platform categories, detected from job images, scripts (read as a minimal shell, not grepped) and GitHub Actions `uses:`. |
| **Toolchain view** | Named service instances (`.devsecops/toolchain.yaml`) and their integrations with jobs: push, upload-report, fetch-secret, notify. Inference proposes, the file decides. |
| **Catalogue** | 62 tools with licence, logo, detection patterns and ready-to-insert GitLab and GitHub snippets. Insertion is previewed as a diff before anything is written. |
| **Fleet** | `keelson apply ops.json repo-a repo-b …` replays the same serialisable operations across N repositories, all-or-nothing per repository, with `--dry-run` diffs and `--json` output for automation. |
| **CI gate** | `keelson coverage --require secrets,sca,sast` exits non-zero when a required layer is missing. |

## Commands

```sh
keelson start                       # local web UI on the current repository
keelson validate [file]             # pipeline + toolchain diagnostics, text or --format json
keelson coverage [file] --require secrets,sast   # OWASP coverage, exit 1 if a layer is missing
keelson export --format mermaid     # markdown | mermaid | json
keelson catalog lint [dir]          # lint a tool catalogue
keelson apply ops.json [repo...] [--rebase] [--dry-run] [--json]   # fleet edits
```

`[file]` defaults to `.gitlab-ci.yml`; pass `.github/workflows/<name>.yml` for a GitHub workflow.

### Fleet example

```sh
# one operation file, rebased on each repository's current text
cat > add-gitleaks.json <<'JSON'
{ "v": 1, "baseHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "kind": "addJob",
  "job": { "id": "secrets", "stage": "test", "script": ["gitleaks git --redact"] } }
JSON

keelson apply add-gitleaks.json services/* --rebase --dry-run   # review the diffs
keelson apply add-gitleaks.json services/* --rebase --json      # apply, machine-readable report
```

## Security model of the local server

`keelson start` binds to `127.0.0.1` only, checks the `Host` header (DNS-rebinding defence),
requires a per-session 32-byte token compared in constant time, serves only the files it detected,
refuses symlinks that leave the repository, caps request bodies at 1 MB, and writes atomically
(temp file, `fsync`, `rename`) through a per-document queue with idempotent operation ids. Details:
[specs/01-plan.md §7 ter](specs/01-plan.md).

## Support matrix

| | Read | Coverage | Edit |
| --- | --- | --- | --- |
| GitLab CI (`.gitlab-ci.yml`, local includes) | yes | yes | yes |
| GitHub Actions (`.github/workflows/*.yml`) | yes | yes | not yet ([ecarts](specs/ecarts.md)) |

## Project layout

```
packages/core            pipeline + toolchain IR, operations, diagnostics, messages
packages/adapter-gitlab  GitLab CI ↔ IR, CST-based lossless editing
packages/adapter-github  GitHub Actions → IR
packages/taxonomy        OWASP layers + platform categories
packages/catalog         tools/*.yaml, schema, detection, compiled catalog.json
packages/toolchain       .devsecops/toolchain.yaml, layout.json, integration proposals
packages/server          local HTTP + SSE server
packages/ui              React 19 + Vite + Tailwind v4
packages/cli             the `keelson` binary (bundled for Node)
```

Architecture decisions live in [specs/adr/](specs/adr/), public error codes in
[specs/diagnostics.md](specs/diagnostics.md), the plan in [specs/01-plan.md](specs/01-plan.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## Licence

Apache-2.0 — Copyright 2026 Khalid Ouhmid.
