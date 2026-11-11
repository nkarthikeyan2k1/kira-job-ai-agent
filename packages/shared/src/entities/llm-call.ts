import { z } from "zod";
import { LlmTierSchema } from "../enums.ts";

export const LlmCallSchema = z.object({
  id: z.number().int(),
  task: z.string().min(1),
  tier: LlmTierSchema,
  model: z.string().min(1),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  // Postgres numeric arrives as a string (to keep precision); coerce it.
  costUsd: z.coerce.number().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  ok: z.boolean(),
  error: z.string().nullable(),
  jobId: z.string().nullable(),
  promptVersion: z.string().nullable(),
  createdAt: z.date(),
});
export type LlmCall = z.infer<typeof LlmCallSchema>;
