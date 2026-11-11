import { z } from "zod";
import {
  AtsTypeSchema,
  JobChunkSectionSchema,
  RemoteTypeSchema,
  SalaryPeriodSchema,
  SeniorityLevelSchema,
} from "../enums.ts";

// The embedding column is deliberately not part of these schemas: vectors are
// read and written only by the AI code, never carried around with a row.

export const JobSchema = z.object({
  id: z.string().min(1), // "gh:{board}:{id}", "wd:{tenant}:{id}"
  companyId: z.string().min(1),
  source: AtsTypeSchema,
  externalId: z.string().min(1),
  url: z.url(),
  urlNormalized: z.string().min(1),
  fingerprint: z.string().min(1), // hash(company + title + location), for cross-source dupes
  title: z.string().min(1),
  location: z.string().nullable(),
  locationNorm: z.string().nullable(),
  remoteType: RemoteTypeSchema.nullable(),
  seniority: SeniorityLevelSchema.nullable(),
  yearsMin: z.number().int().nonnegative().nullable(),
  // Salary is stored only when the posting states it; never inferred.
  salaryMin: z.number().int().nonnegative().nullable(),
  salaryMax: z.number().int().nonnegative().nullable(),
  salaryCurrency: z.string().length(3).nullable(),
  salaryPeriod: SalaryPeriodSchema.nullable(),
  description: z.string().min(1), // clean text, archived at first fetch
  descriptionHash: z.string().min(1),
  postedAt: z.date().nullable(),
  firstSeen: z.date(),
  lastSeen: z.date(),
  closedAt: z.date().nullable(),
  embeddingModel: z.string().nullable(),
});
export type Job = z.infer<typeof JobSchema>;

export const JobChunkSchema = z.object({
  id: z.number().int(),
  jobId: z.string().min(1),
  section: JobChunkSectionSchema,
  ordinal: z.number().int().nonnegative(),
  content: z.string().min(1),
  embeddingModel: z.string().nullable(),
});
export type JobChunk = z.infer<typeof JobChunkSchema>;
