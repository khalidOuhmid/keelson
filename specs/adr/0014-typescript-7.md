# ADR 0014 — TypeScript 7 is kept, not pinned back to 5.9

**Status**: accepted, 2026-11-12.

## Context

Milestone L0 installed TypeScript 7, the native port, because it was the current version. It drops
`baseUrl` and requires relative `paths`. The 2026-10-20 gap asked to pin TypeScript 5.9 if a tool
the project needs broke on it.

Every milestone since then has been built on 7.0.2: `yaml`, `zod`, `elkjs`, `@xyflow/react`,
`zustand`, CodeMirror 6, `fast-check`, Vite, Tailwind CSS v4, Biome, Playwright, `bun test` and
`bun build --target=node`. None of them reads the `typescript` package: Biome, Vite and Bun strip
types with their own parsers, and `tsc -b` is the only consumer of the compiler.

## Decision

Keep TypeScript 7. `bun.lock` pins the exact version; the `^7` range in `package.json` only moves
when the lockfile is regenerated, which is a reviewed change.

`scripts/check-config.test.ts` guards the two constraints of version 7 in `tsconfig.base.json` —
no `baseUrl`, relative `paths` — and checks that the installed compiler is still major 7, so that a
silent downgrade or a copied 5.x configuration fails `bun run test`.

## Consequences

TypeScript 7 has no stable JavaScript compiler API. A future dependency that imports `typescript`
programmatically (declaration bundlers, `ts-morph`, type-aware lint plugins, `vite-plugin-dts`)
will not work. Adding one reopens this decision: pin 5.9 for that tool, or choose another.
