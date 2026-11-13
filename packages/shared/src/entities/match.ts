import { z } from "zod";
import { RequirementResultSchema } from "../scoring.ts";

export const HardFilterResultSchema = z.object({
  passed: z.boolean(),
  // false for manual jobs: the failures are shown, but the job is scored anyway.
  enforced: z.boolean().default(true),
  failed: z.array(z.object({ rule: z.string().min(1), detail: z.string() })),
  // Rules that could not be checked because the posting lacks the data
  // (e.g. no salary stated). Unknown never fails a job.
  unknown: z.array(z.string()).default([]),
});
export type HardFilterResult = z.infer<typeof HardFilterResultSchema>;

// A dimension adjustment applied on top of the weighted score (seniority,
// location, salary, domain), stored so a final score can be explained.
export const ScoreAdjustmentSchema = z.object({
  dimension: z.string().min(1),
  delta: z.number(),
  reason: z.string(),
});
export type ScoreAdjustment = z.infer<typeof ScoreAdjustmentSchema>;

// Append-only: re-scoring inserts a new row and flips is_current, so scores
// from different prompts/models stay comparable. Score fields are null when
// the job failed a hard filter (no embedding or LLM work was done).
export const MatchSchema = z.object({
  id: z.number().int(),
  jobId: z.string().min(1),
  resumeVersionId: z.number().int(),
  isCurrent: z.boolean(),
  hardFilterResult: HardFilterResultSchema,
  similarity: z.number().min(0).max(1).nullable(), // raw cosine similarity
  similarityNorm: z.number().min(0).max(1).nullable(), // min-max rescaled within the run
  llmScore: z.number().int().min(0).max(100).nullable(), // computed in code from breakdown
  finalScore: z.number().min(0).max(100).nullable(),
  breakdown: z.array(RequirementResultSchema),
  adjustments: z.array(ScoreAdjustmentSchema),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  reason: z.string().nullable(),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
  scoredAt: z.date(),
});
export type Match = z.infer<typeof MatchSchema>;
