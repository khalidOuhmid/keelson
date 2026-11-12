export const PACKAGE_NAME = "@keelson/core";

export * from "./diagnostics.ts";
export * from "./diff.ts";
export * from "./hash.ts";
export * from "./ir.ts";
/** Text rendering is **not** re-exported here: it lives behind `@keelson/core/messages`, so that
 *  the import says which layer is being touched. Only the `params` shapes are, because the
 *  signatures of `Diagnostic` and `OperationError` depend on them. */
export type { MessageCode, MessageParams, ParamsOf } from "./messages/codes.ts";
export * from "./operations.ts";
export * from "./result.ts";
export * from "./toolchain.ts";
export * from "./validate.ts";
