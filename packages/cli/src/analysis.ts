import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { WORKFLOWS_DIR } from "@keelson/adapter-github";
import { createFileReader, readInsideRoot } from "@keelson/adapter-gitlab";
import { loadCatalog } from "@keelson/catalog";
import type { Diagnostic, Pipeline } from "@keelson/core";
import { mergePipelines, TOOLCHAIN_FILE, validate } from "@keelson/core";
import {
  adapterFor,
  detectWorkspace,
  isNestedWorkflow,
  readDisk,
  unreadableToolchain,
} from "@keelson/server";
import {
  analyseToolchain,
  LAYOUT_FILE,
  type ParsedLayout,
  parseLayout,
  type ToolchainAnalysis,
} from "@keelson/toolchain";
import { nestedWorkflowMessage, readInside, refusalMessage } from "./files.ts";

export const DEFAULT_FILE = ".gitlab-ci.yml";

const NO_CI_FILE = `file not found: neither ${DEFAULT_FILE} nor a workflow in ${WORKFLOWS_DIR}`;

/** The root from which GitLab resolves `include: local`. We walk up to the first directory that
 *  contains a `.git`, because that is the repository root GitLab uses. Without a repository — an
 *  isolated file, a test — it is the file's directory, which matches the usual case where
 *  `.gitlab-ci.yml` sits at the root. */
function repositoryRoot(file: string): string {
  let current = dirname(file);
  while (true) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return dirname(file);
    }
    current = parent;
  }
}

/** The file path relative to the root, with `/` separators: the form `include` expects and the
 *  one diagnostics carry. */
function relativeTo(root: string, file: string): string {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return file.startsWith(prefix) ? file.slice(prefix.length).split(sep).join("/") : basename(file);
}

export type Analysis = {
  root: string;
  /** The texts by relative path, included files too: a diagnostic is located in the text of its
   *  own file. */
  texts: ReadonlyMap<string, string>;
  pipeline: Pipeline;
  /** The parse diagnostics alone: coverage reads from them that a file is unreadable. */
  parsing: Diagnostic[];
  layout: ParsedLayout;
  toolchain: ToolchainAnalysis;
  diagnostics: Diagnostic[];
};

export type Target = { file: string; text: string };

/** The files of a command: the one it names, otherwise the whole workspace. Returns the usage
 *  message if one of them is missing. */
export function readTargets(
  named: string | undefined,
  cwd: string,
): { ok: true; targets: Target[] } | { ok: false; message: string } {
  const detected = named === undefined ? detectWorkspace(cwd).map((entry) => entry.path) : [];
  const paths = named !== undefined ? [named] : detected.length > 0 ? detected : [DEFAULT_FILE];

  const targets: Target[] = [];
  for (const path of paths) {
    const file = isAbsolute(path) ? path : resolve(cwd, path);
    const root = repositoryRoot(file);
    const relative = relativeTo(root, file);
    if (isNestedWorkflow(file)) {
      return { ok: false, message: nestedWorkflowMessage(path) };
    }
    const read = readInside(root, relative);
    if (!read.ok) {
      return {
        ok: false,
        message:
          named === undefined && read.reason === "absent"
            ? NO_CI_FILE
            : refusalMessage(read.reason, file),
      };
    }
    targets.push({ file, text: read.text });
  }
  return { ok: true, targets };
}

function toolchainOf(
  root: string,
  pipeline: Pipeline,
  parsing: readonly Diagnostic[],
): ToolchainAnalysis {
  const disk = readDisk(root, TOOLCHAIN_FILE);
  const analysis = analyseToolchain(
    disk.kind === "text" ? disk.text : null,
    pipeline,
    loadCatalog().tools,
    parsing,
  );
  return disk.kind === "unreadable"
    ? { ...analysis, diagnostics: [unreadableToolchain(), ...analysis.diagnostics] }
    : analysis;
}

/** What `validate`, `coverage` and `export` know about the files: they must say the same thing. */
export function analyse(targets: readonly Target[]): Analysis {
  const root = repositoryRoot((targets[0] as Target).file);
  const read = createFileReader(root);
  const parsed = targets.map(({ file, text }) => {
    const main = relativeTo(root, file);
    return { main, text, result: adapterFor(file).parse(text, { file: main, read }) };
  });

  const pipeline = mergePipelines(parsed.map(({ result }) => result.pipeline));
  const parsing = parsed.flatMap(({ result }) => result.diagnostics);
  const layout = parseLayout(readInsideRoot(root, LAYOUT_FILE), pipeline, parsing);
  const toolchain = toolchainOf(root, pipeline, parsing);

  return {
    root,
    texts: new Map(
      parsed.flatMap(({ main, text, result }) => [
        [main, text] as const,
        ...Object.entries(result.included),
      ]),
    ),
    pipeline,
    parsing,
    layout,
    toolchain,
    diagnostics: [
      ...parsed.flatMap(({ result }) => [...result.diagnostics, ...validate(result.pipeline)]),
      ...layout.diagnostics,
      ...toolchain.diagnostics,
    ],
  };
}
