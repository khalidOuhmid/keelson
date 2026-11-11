# Contributing to Keelson

Thanks for helping. Keelson edits other people's CI files, so the bar is correctness first.

## Setup

Requirements: [Bun](https://bun.com) ≥ 1.4 for tooling, Node ≥ 20 to run the built binary.

```sh
bun install --frozen-lockfile
bun run check        # lint + typecheck + build + unit tests (what CI runs)
bunx playwright install chromium   # once, before the first e2e run
bun run e2e          # Playwright end-to-end tests on the real binary
bun run dev          # local server on a dev fixture + Vite UI on http://localhost:5283
```

## Rules

- **Test first.** Every behaviour starts as a failing test. No untested code.
- **The repository is the source of truth.** A parse → emit with no change must be byte-identical.
  Changes to `adapter-gitlab` must pass the property tests with `KEELSON_FC_RUNS=500`.
- **Runtime packages stay Node-compatible**: no `Bun.*` or `bun:*` in the `src/` of `cli`, `core`,
  `server`, `taxonomy`, `catalog`, `adapter-*`, `toolchain` (enforced by `scripts/check-runtime.ts`).
- **UI state is tested where it is seen**: anything computed for the UI needs a DOM or E2E test.
- **Error codes are a public contract**: every code is documented in
  [specs/diagnostics.md](specs/diagnostics.md) with its `params`, and rendered in English by
  `@keelson/core/messages`. Nothing on the wire carries prose.
- **Dated debt**: `// DEBT(YYYY-MM-DD): what — why`. Out-of-scope findings go to
  [specs/gaps.md](specs/gaps.md).
- **Never add CI files from an employer or a client to the test corpus.**
- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `build:`, `ci:`, `chore:`).

## Adding a tool to the catalogue

1. Add `packages/catalog/tools/<id>.yaml` (schema in `packages/catalog/src/schema.ts`): layers,
   licence, detection (`images`, `scripts` regexes, GitHub `actions`), GitLab and GitHub snippets,
   `lastVerified`.
2. `bun run catalog:build` and commit the regenerated `catalog.json`.
3. `bun run build && node packages/cli/dist/keelson.js catalog lint packages/catalog/tools`.

## Releasing

1. Bump `version` in `packages/cli/package.json`. It is the only published package; every other
   workspace package is private and stays at `0.0.0`.
2. Commit, tag `vX.Y.Z` matching that version, and push the tag.
3. `.github/workflows/release.yml` runs `bun run check`, checks that the tag matches the version, and
   runs `npm publish --provenance`. It needs a repository secret `NPM_TOKEN` (an npm automation
   token with publish rights on `keelson`).

Project conventions in depth: [CLAUDE.md](CLAUDE.md). Specs, plan and ADRs: [specs/](specs/).
