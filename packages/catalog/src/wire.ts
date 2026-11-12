import { LAYER_IDS } from "@keelson/taxonomy";
import { z } from "zod";
import type { Coverage } from "./coverage.ts";

const layer = z.enum(LAYER_IDS);
const names = z.array(z.string()).readonly();

/** Coverage as a client receives it from the network: no layer outside the taxonomy, no field
 *  missing. */
export const coverageSchema = z.object({
  jobs: z
    .array(
      z.object({
        job: z.string(),
        layers: z.array(layer).readonly(),
        tools: names,
        overridden: z.boolean(),
      }),
    )
    .readonly(),
  layers: z
    .array(
      z.object({
        layer,
        covered: z.boolean(),
        jobs: names,
        services: names,
        ci: z.array(z.enum(["gitlab-ci", "github-actions"])).readonly(),
      }),
    )
    .readonly(),
  partial: z.boolean(),
});

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const COVERAGE_SCHEMA_MATCHES: Same<z.output<typeof coverageSchema>, Coverage> = true;
