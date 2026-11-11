# Keelson

## The project in five lines

Keelson is an open-source tool for visually designing a DevSecOps chain before implementing it. It
reads and rewrites a repository's native CI YAML (GitLab CI first, GitHub Actions next) as a lossless
round-trip, and models alongside it the platform services (Nexus, Harbor, DefectDojo, Vault,
Sentry…) and their integrations with jobs. An overlay shows coverage of the 13 layers of the OWASP
DevSecOps Guideline, plus platform categories outside OWASP, and a catalogue of 50 to 100 tools
suggests implementations for uncovered layers.

Detailed plan and milestone breakdown: [specs/01-plan.md](specs/01-plan.md). Vision:
[specs/00-vision.md](specs/00-vision.md).

## Working rules (non-negotiable)

- **Production mode, no POC. Strict TDD.** For every behaviour: write the test, watch it fail, then
  implement. No untested code.
- **English everywhere.** Documentation, specs, code comments, test titles and commit messages are
  written in English.
- **All debt is dated in the code**: `// DEBT(YYYY-MM-DD): <what> — <why>`.
- **Anything outside the scope of the current milestone goes into [specs/gaps.md](specs/gaps.md)**
  (date, finding, impact, proposal). Never into the current milestone.
- **Render test boundary.** Any state or data computed for the UI — the store, a pure layer such as
  `graph.ts` or `layout.ts` — must have at least one test that checks its **effect in the rendered
  DOM or in E2E**, not just its value. A computed field with no on-screen consumer is either wired
  up or deleted. A test that stops at the store covers a computation, not a behaviour.
- **Layout invariants.** Consistency between the IR and the display — a job in its stage's column,
  the header count equal to the number of nodes in the column, no overlapping nodes — is tested **on
  the render and in E2E**, not only on the computed coordinates.
- No superfluous explanatory comments in the code.
- Do not install a dependency the current milestone does not use.
- **Conventional commits** (`chore:`, `build:`, `test:`, `docs:`, `ci:`, `feat:`, `fix:`) on a
  `milestone/<id>-<slug>` branch. Branches of earlier milestones keep their historical `lot/<id>-<slug>`
  names.

## Verification before any PR

```sh
bun run check && bun run e2e
```

## Stack

- **Bun**: package manager, workspaces, scripts, test runner (`bun test`). Versions pinned by
  `bun.lock`.
- **TypeScript** strict everywhere (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`), project references, `tsc -b` for typechecking (declarations only,
  in `types/`). Global types are isolated per project — see the Node runtime constraint below.
- **Biome** for linting and formatting. No ESLint, no Prettier.
- **UI** (`packages/ui`): React 19 + Vite + Tailwind CSS v4. Component tests with `bun test` +
  Testing Library + happy-dom (preload `scripts/test-preload.ts` declared in `bunfig.toml`). E2E
  with Playwright (`packages/ui/e2e/*.e2e.ts`).

### Node runtime constraint (mandatory)

The packages that run on the user's machine — `cli`, `core`, `server`, `taxonomy`, `catalog`,
`adapter-gitlab`, `adapter-github`, `toolchain` — use **no Bun-specific API** in their `src/`:
neither `Bun.*` nor `bun:*`. They are built with `bun build --target=node` so that `npx keelson`
works on Node ≥ 20 without Bun installed. Bun remains the development tooling.

Two independent barriers enforce it:

1. **The typecheck.** Each runtime package's `tsconfig.json` declares `"types": ["node"]` and
   includes only `src/`: Bun's types are not visible there, so `tsc -b` rejects any reference to
   `Bun` or `bun:*`. The `test/` folders of these packages are typed separately by
   `tsconfig.tests.json` at the root (`"types": ["bun", "node"]`, `noEmit`), and can therefore use
   `bun:test` freely. `bun run typecheck` runs both passes.
   `scripts/` and `packages/ui` keep Bun's types.
2. **The `scripts/check-runtime.ts` guard**, verified by `scripts/check-runtime.test.ts`: it fails
   if a `src/` file of a runtime package imports `bun:*` or references `Bun.`. It catches what the
   typecheck cannot see (files not included in a project, usages inside strings, `globalThis.Bun`).

When adding a runtime package, give it `"types": ["node"]`, register it in `RUNTIME_PACKAGES` in
`scripts/check-runtime.ts` and add its `test/` to `tsconfig.tests.json`.

### Installed dependencies

| Dependency      | Where                           | Purpose                                      |
| --------------- | ------------------------------- | -------------------------------------------- |
| `yaml` (eemeli) | `adapter-gitlab`, `adapter-github`, `catalog`, `toolchain` | parsing, node ranges, anchors, merge |
| `zod` v4        | `core`, `adapter-gitlab`, `catalog`, `toolchain` | operation schemas, catalogue entries, layout |
| `@xyflow/react` | `ui`                            | pipeline graph rendering                     |
| `yaml` (eemeli) | `adapter-github`                | workflows, same in-place patching as GitLab  |
| `elkjs`         | `ui`                            | layered, deterministic layout                |
| `zustand`       | `ui`                            | UI state, undo/redo                          |
| CodeMirror 6    | `ui`                            | read-only opaque YAML blocks                 |
| `fast-check`    | root devDependency              | property-based tests                         |
| `simple-icons`  | root devDependency              | CC0 paths compiled into `catalog.json`       |

No dependency is currently waiting for a future milestone.

`commander` was ultimately not installed: the CLI parses its arguments by hand, which is enough as
long as the commands stay simple, and keeps a dependency out of the `npx keelson` bundle.

## Root scripts

| Script               | Effect                                                 |
| -------------------- | ------------------------------------------------------ |
| `bun run lint`       | `biome check .`                                        |
| `bun run format`     | `biome check --write .`                                |
| `bun run typecheck`  | `tsc -b` then `tsc -p tsconfig.tests.json`             |
| `bun run test`       | `bun test` across all packages                         |
| `bun run build`      | builds all packages, CLI targeting Node                |
| `bun run e2e`        | Playwright                                             |
| `bun run check`      | lint + typecheck + build + test — what CI runs         |
| `bun run corpus:update` | regenerates the corpus IR goldens (review the diff) |
| `bun run catalog:build` | compiles `tools/*.yaml` into the committed `catalog.json` |
| `bun run dev`        | local server on the dev fixture + Vite on 5283         |

## Front-end development

`bun run dev` starts two processes:

1. `scripts/dev.ts` starts the server **programmatically** (not through the CLI) on
   `packages/ui/dev-fixture/`, port 5284, with a fixed development token;
2. Vite serves the UI on **5283** and proxies `/api` to the server, adding the token header, so the
   dev UI does not need a token in its URL.

`changeOrigin` is essential in this proxy: it rewrites the `Host` header to `127.0.0.1:5284`, which
the server's `Host` check requires. A test (`packages/ui/test/devProxy.test.ts`) keeps the token,
the port and this option consistent between the script and the Vite configuration.

`KEELSON_DEV_FIXTURE=includes bun run dev` opens `packages/ui/dev-fixture-includes/`, a pipeline
split across several files, for the include surfaces.

The dev fixture is a deliberately rich pipeline: four stages, object-form and optional needs,
`extends`, environment. E2E tests work on a temporary copy of it.

## Property-based tests

The fast-check properties live in `packages/adapter-gitlab/test/properties/`. They check round-trip,
invertibility, determinism and edit locality across the whole corpus.

- `KEELSON_FC_RUNS` sets the number of runs (25 by default, to keep `bun run test` under two
  seconds). Before a PR that touches `adapter-gitlab`, use `KEELSON_FC_RUNS=500`.
- `KEELSON_FC_SEED` forces a seed. In CI the seed is fixed at `20261020` so failures are
  reproducible; locally it is random, and fast-check prints the seed and the minimal counterexample
  on failure.

`packages/toolchain/test/properties/` checks the same four properties on `toolchain.yaml`, with its
own corpus in `packages/toolchain/test/corpus/`.

`packages/adapter-github/test/properties/` does the same for workflows, with 22 MIT files from
`actions/starter-workflows` (SHA and notice in `LICENSES.md`);
`KEELSON_UPDATE_GOLDENS=1 bun test packages/adapter-github/test/corpus.test.ts` regenerates its
goldens (review the diff).

The corpus lives in `packages/adapter-gitlab/test/corpus/`: `gitlab-templates/` (20 official MIT
templates, provenance and SHA in `LICENSES.md`, integrity in `CHECKSUMS.txt`), `edge-cases/`
(in-house fixtures) and `goldens/` (expected IR). **Never add a CI file coming from an employer or a
client.**

## Front-end workflow with Impeccable (mandatory for any change in `packages/ui`)

The [Impeccable](https://github.com/pbakaus/impeccable) plugin judges and guides the whole front end.

1. **Before** coding a view or a component: `/impeccable shape`.
2. **After** implementation: `/impeccable critique` then `/impeccable audit`, and fix whatever comes
   out of them.
3. **Before** opening the PR: `/impeccable polish`.
4. `PRODUCT.md` and `DESIGN.md` (generated by `/impeccable init`) are the **design source of
   truth**: no hard-coded colour, size or spacing outside the tokens they define.

## Monorepo layout

```
packages/core/            pipeline IR + toolchain
packages/taxonomy/        OWASP layers + platform categories
packages/catalog/         tools/*.yaml, schema, compiled catalog.json
packages/adapter-gitlab/  GitLab CI ↔ IR
packages/adapter-github/  GitHub Actions ↔ IR
packages/toolchain/       .devsecops/toolchain.yaml, layout.json, integration proposals
packages/server/          local server for keelson start: API, SSE, atomic writes
packages/ui/              React + Vite + Tailwind
packages/cli/             `keelson` binary
scripts/                  dev tooling (runtime guard, test preload)
specs/                    vision, plan, gaps
```

Each package exports a `PACKAGE_NAME` constant equal to the name in its `package.json`, checked by a
test: it is the smoke test for the workspace, module resolution and `bun test`. Do not remove it.
