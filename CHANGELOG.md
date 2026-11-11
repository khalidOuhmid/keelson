# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Only the `keelson` npm package is
versioned; workspace packages are private.

## [Unreleased]

## [0.1.0] — first public release

### Added

- **GitLab CI round-trip.** Reads `.gitlab-ci.yml` with local `include:` (nested, mixed lists,
  `*` and `**` wildcards), `extends`, anchors and `default:`; edits by byte-level patches that keep
  comments, key order and anchors. Remote includes are reported, not resolved.
- **GitHub Actions round-trip.** Reads and edits `.github/workflows/*.yml`. Jobs are laid out by
  dependency level, since GitHub has no stages. Renames and removals that an expression could break
  (`needs.<id>`, `jobs.<id>`, or the `needs` / `jobs` context read as a whole) are refused rather
  than silently corrupting the workflow.
- **Serialisable operations.** Every edit is a JSON operation with a `baseHash`, and every
  successful operation returns an inverse `splice`. Stable, documented error codes.
- **OWASP DevSecOps coverage.** 13 OWASP DevSecOps Guideline layers and 8 platform categories,
  detected from images, scripts parsed as a minimal shell, and GitHub Actions `uses:`.
- **Catalogue.** 62 tools with licence, logo, detection rules and GitLab / GitHub snippets;
  insertion previewed as a diff.
- **Toolchain.** `.devsecops/toolchain.yaml` for named platform services and their integrations
  with jobs; inferred integrations are proposed, then confirmed or dismissed.
- **Local web UI** (`keelson start`): pipeline, toolchain, coverage and catalogue views; undo and
  redo; live reload on external changes. Bound to `127.0.0.1`, Host check, per-session token,
  atomic writes.
- **CLI**: `validate`, `coverage` (with `--require` as a CI gate), `export` (Markdown, Mermaid,
  JSON), `catalog lint`, and `apply` to replay operations across many repositories, all or nothing
  per repository, with `--rebase`, `--dry-run` and `--json`.
- Runs on Node 20, 22 and 24 with no runtime dependency; the package ships its licence and the
  notices of every bundled component.

[Unreleased]: https://github.com/khalidOuhmid/keelson/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/khalidOuhmid/keelson/releases/tag/v0.1.0
