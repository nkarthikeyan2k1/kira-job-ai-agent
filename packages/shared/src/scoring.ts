import { z } from "zod";

// One JD requirement checked against the resume by the local LLM.
// The LLM returns evidence, not a score: scoring/score.ts turns a list of
// these into llm_score deterministically.
export const RequirementResultSchema = z.object({
  requirement: z.string().min(1),
  weight: z.enum(["must", "nice"]),
  status: z.enum(["met", "partial", "missing"]),
  // Must be an exact quote from the resume; the agent drops it if not found.
  evidence: z.string().nullable(),
});
export type RequirementResult = z.infer<typeof RequirementResultSchema>;
