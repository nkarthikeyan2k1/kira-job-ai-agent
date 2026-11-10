import { z } from "zod";

// Contracts for the agent's HTTP API. The web app validates responses with
// these schemas instead of trusting the payload.

export const CheckResultSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number(),
  error: z.string().optional(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.record(z.string(), CheckResultSchema),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
