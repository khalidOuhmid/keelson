export const PACKAGE_NAME = "@keelson/catalog";

export { type Catalog, type Logo, loadCatalog } from "./catalog.ts";
export {
  type CiSystem,
  type Coverage,
  coverage,
  type JobCoverage,
  type LayerCoverage,
  type LayerOverrides,
} from "./coverage.ts";
export {
  type DetectedIntegration,
  type Detection,
  detectIntegrations,
  detectTools,
} from "./detect.ts";
export { isOpenSource } from "./licenses.ts";
export { lintCatalog, STALE_AFTER_MONTHS, type ToolFile } from "./lint.ts";
export { type ParsedTool, parseTool, type Tool, toolSchema } from "./schema.ts";
export { coverageSchema } from "./wire.ts";
