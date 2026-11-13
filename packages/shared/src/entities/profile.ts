import { z } from "zod";
import { RemoteTypeSchema, SeniorityLevelSchema } from "../enums.ts";

// Single-row table: what jobs are filtered and scored against. PII, local only.
export const ProfileSchema = z.object({
  targetRoles: z.array(z.string()),
  skills: z.array(z.string()),
  experienceYears: z.coerce.number().nonnegative().nullable(), // numeric → string from pg
  seniority: SeniorityLevelSchema.nullable(), // my own level
  targetSeniority: z.array(SeniorityLevelSchema), // levels I would apply to
  // A job title must contain one "include" phrase and no "exclude" phrase.
  titleKeywordsInclude: z.array(z.string()),
  titleKeywordsExclude: z.array(z.string()),
  locations: z.array(z.string()), // cities (or countries) I would work from
  remoteTypes: z.array(RemoteTypeSchema),
  salaryMin: z.number().int().nonnegative().nullable(), // per year, in salaryCurrency
  salaryCurrency: z.string().length(3).nullable(),
  workAuthCountries: z.array(z.string()), // where I can work without sponsorship
  needsSponsorship: z.boolean().nullable(), // outside workAuthCountries
  noticePeriodDays: z.number().int().nonnegative().nullable(),
  dealBreakers: z.array(z.string()), // phrases that rule a posting out
  updatedAt: z.date(),
});
export type Profile = z.infer<typeof ProfileSchema>;

/** What profile.json holds: the profile without the database's timestamp. Unknown keys are rejected to catch typos. */
export const ProfileInputSchema = ProfileSchema.omit({ updatedAt: true }).strict();
export type ProfileInput = z.infer<typeof ProfileInputSchema>;
