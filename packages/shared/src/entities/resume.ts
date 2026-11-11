import { z } from "zod";
import { ResumeSectionSchema } from "../enums.ts";

export const ResumeVersionSchema = z.object({
  id: z.number().int(),
  label: z.string().min(1),
  sourcePath: z.string().nullable(),
  content: z.string().min(1), // full resume text; PII, local database only
  contentHash: z.string().min(1),
  isActive: z.boolean(), // at most one active version
  createdAt: z.date(),
});
export type ResumeVersion = z.infer<typeof ResumeVersionSchema>;

export const ResumeChunkSchema = z.object({
  id: z.number().int(),
  resumeVersionId: z.number().int(),
  section: ResumeSectionSchema,
  ordinal: z.number().int().nonnegative(),
  content: z.string().min(1),
  embeddingModel: z.string().nullable(),
});
export type ResumeChunk = z.infer<typeof ResumeChunkSchema>;
