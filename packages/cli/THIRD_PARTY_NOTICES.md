# Third-party notices

The `keelson` package bundles the third-party software listed below into `dist/keelson.js`
(the CLI and local server) and `dist/ui/` (the web UI). Each component remains under its own
licence; the full licence texts are in each project's repository at the version shown.

| Component | Licence | Version | Source |
| --- | --- | --- | --- |
| `@codemirror/autocomplete` | MIT | 6.20.4 | https://code.haverbeke.berlin/codemirror/autocomplete |
| `@codemirror/lang-yaml` | MIT | 6.1.3 | https://github.com/codemirror/lang-yaml |
| `@codemirror/language` | MIT | 6.13.1 | https://code.haverbeke.berlin/codemirror/language |
| `@codemirror/state` | MIT | 6.7.6 | https://code.haverbeke.berlin/codemirror/state |
| `@codemirror/streamparser` | MIT | 6.0.0 | https://code.haverbeke.berlin/codemirror/streamparser |
| `@codemirror/view` | MIT | 6.43.15 | https://code.haverbeke.berlin/codemirror/view |
| `@lezer/common` | MIT | 1.5.3 | https://code.haverbeke.berlin/lezer/common |
| `@lezer/highlight` | MIT | 1.2.5 | https://code.haverbeke.berlin/lezer/highlight |
| `@lezer/lr` | MIT | 1.4.11 | https://code.haverbeke.berlin/lezer/lr |
| `@lezer/yaml` | MIT | 1.0.4 | https://github.com/lezer-parser/yaml |
| `@marijn/find-cluster-break` | MIT | 1.0.4 | https://code.haverbeke.berlin/marijn/find-cluster-break |
| `@xyflow/react` | MIT | 12.12.0 | https://github.com/xyflow/xyflow |
| `@xyflow/system` | MIT | 0.0.83 | https://github.com/xyflow/xyflow |
| `classcat` | MIT | 5.0.5 | https://github.com/jorgebucaran/classcat |
| `crelt` | MIT | 1.0.7 | https://code.haverbeke.berlin/marijn/crelt |
| `d3-color` | ISC | 3.1.0 | https://github.com/d3/d3-color |
| `d3-dispatch` | ISC | 3.0.1 | https://github.com/d3/d3-dispatch |
| `d3-drag` | ISC | 3.0.0 | https://github.com/d3/d3-drag |
| `d3-ease` | BSD-3-Clause | 3.0.1 | https://github.com/d3/d3-ease |
| `d3-interpolate` | ISC | 3.0.1 | https://github.com/d3/d3-interpolate |
| `d3-selection` | ISC | 3.0.0 | https://github.com/d3/d3-selection |
| `d3-timer` | ISC | 3.0.1 | https://github.com/d3/d3-timer |
| `d3-transition` | ISC | 3.0.1 | https://github.com/d3/d3-transition |
| `d3-zoom` | ISC | 3.0.0 | https://github.com/d3/d3-zoom |
| `elkjs` | EPL-2.0 OR GPL-3.0-or-later | 0.12.0 | https://github.com/kieler/elkjs |
| `react` | MIT | 19.3.1 | https://github.com/react/react |
| `react-dom` | MIT | 19.3.1 | https://github.com/react/react |
| `scheduler` | MIT | 0.28.0 | https://github.com/react/react |
| `style-mod` | MIT | 4.1.4 | https://code.haverbeke.berlin/marijn/style-mod |
| `use-sync-external-store` | MIT | 1.7.0 | https://github.com/react/react |
| `w3c-keyname` | MIT | 2.2.8 | https://github.com/marijnh/w3c-keyname |
| `yaml` | ISC | 2.9.1 | https://github.com/eemeli/yaml |
| `zod` | MIT | 4.6.7 | https://github.com/colinhacks/zod |
| `zustand` | MIT | 4.5.7 | https://github.com/pmndrs/zustand |

## Notes

- **elkjs** is dual-licensed `EPL-2.0 OR GPL-3.0-or-later`. Keelson uses it under the
  **Eclipse Public License 2.0**, unmodified. Its source code is available at
  https://github.com/kieler/elkjs.
- **simple-icons** (CC0-1.0): the catalogue embeds SVG paths from simple-icons
  (https://github.com/simple-icons/simple-icons), compiled into `catalog.json`. CC0 covers the
  path data, not the trademarks: each logo remains the trademark of its owner, and its use here
  does not imply endorsement.
- The official GitLab CI templates used as a test corpus (MIT, provenance in
  `packages/adapter-gitlab/test/corpus/LICENSES.md`) are **not** shipped in this package.

This file is checked by `packages/cli/test/publish.test.ts`: every production dependency bundled
into the package must be listed with its licence.
