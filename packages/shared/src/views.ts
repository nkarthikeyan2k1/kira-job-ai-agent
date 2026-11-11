import { z } from "zod";
import { JobStatusSchema } from "./enums.ts";
import { ApplicationSchema } from "./entities/application.ts";
import { CompanySchema } from "./entities/company.ts";
import { JobSchema } from "./entities/job.ts";
import { MatchSchema } from "./entities/match.ts";

// Read models for the dashboard: each is the shape of one joined query row,
// built from the entity schemas so a column is described in exactly one place.

export const MatchSummarySchema = JobSchema.pick({
  title: true,
  location: true,
  remoteType: true,
  url: true,
  firstSeen: true,
}).extend({
  jobId: JobSchema.shape.id,
  company: CompanySchema.shape.name,
  finalScore: z.number().min(0).max(100), // only scored matches are listed
  reason: MatchSchema.shape.reason,
  status: JobStatusSchema, // application status, or "scored" when there is none yet
});
export type MatchSummary = z.infer<typeof MatchSummarySchema>;

export const MatchDetailSchema = MatchSummarySchema.extend(
  MatchSchema.pick({
    similarity: true,
    llmScore: true,
    matchedSkills: true,
    missingSkills: true,
    breakdown: true,
  }).shape,
);
export type MatchDetail = z.infer<typeof MatchDetailSchema>;

export const ApplicationRowSchema = ApplicationSchema.pick({
  jobId: true,
  status: true,
  appliedAt: true,
  nextFollowUpAt: true,
  notes: true,
}).extend({
  company: CompanySchema.shape.name,
  title: JobSchema.shape.title,
});
export type ApplicationRow = z.infer<typeof ApplicationRowSchema>;
