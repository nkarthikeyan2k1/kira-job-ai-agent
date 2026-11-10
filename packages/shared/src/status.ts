import { z } from "zod";

// Lifecycle of a job from discovery to outcome. Allowed transitions live in
// apps/agent/src/tracker/, not here: this file only names the states.
export const APPLICATION_STATUSES = [
  "found",
  "scored",
  "shortlisted",
  "applied",
  "responded",
  "interview",
  "offer",
  "rejected",
  "skipped",
  "ghosted",
  "withdrawn",
  "closed",
] as const;

export const ApplicationStatusSchema = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;

export const ATS_TYPES = ["greenhouse", "lever", "ashby", "workday", "scrape"] as const;

export const AtsTypeSchema = z.enum(ATS_TYPES);
export type AtsType = z.infer<typeof AtsTypeSchema>;
