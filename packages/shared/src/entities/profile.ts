import { z } from "zod";
import { RemoteTypeSchema, SeniorityLevelSchema } from "../enums.ts";

// Single-row table: what jobs are filtered and scored against. PII, local only.
export const ProfileSchema = z.object({
  targetRoles: z.array(z.string()),
  skills: z.array(z.string()),
  experienceYears: z.coerce.number().nonnegative().nullable(), // numeric → string from pg
  seniority: SeniorityLevelSchema.nullable(),
  locations: z.array(z.string()),
  remoteTypes: z.array(RemoteTypeSchema),
  salaryMin: z.number().int().nonnegative().nullable(),
  salaryCurrency: z.string().length(3).nullable(),
  workAuth: z.string().nullable(),
  needsSponsorship: z.boolean().nullable(),
  dealBreakers: z.array(z.string()),
  updatedAt: z.date(),
});
export type Profile = z.infer<typeof ProfileSchema>;
