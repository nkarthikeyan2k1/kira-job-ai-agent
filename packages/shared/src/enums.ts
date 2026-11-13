import { z } from "zod";

// Every enum the database stores as text + CHECK. These arrays are the source
// of truth; an integration test compares them with the CHECK constraints.

// Display lifecycle of a job. "found" and "scored" are derived (job without /
// with a match) and never stored; allowed transitions live in the agent's
// tracker/ module.
export const JOB_STATUSES = [
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
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

// The statuses an applications row can hold: a row is created at shortlist time.
export const APPLICATION_STATUSES = [
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
] as const satisfies readonly JobStatus[];
export const ApplicationStatusSchema = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;

// "manual" is not an ATS: it marks a job I pasted myself. It lives in this
// list because companies.ats and jobs.source share it.
export const ATS_TYPES = ["greenhouse", "lever", "ashby", "workday", "peoplestrong", "scrape", "manual"] as const;
export const AtsTypeSchema = z.enum(ATS_TYPES);
export type AtsType = z.infer<typeof AtsTypeSchema>;

export const REMOTE_TYPES = ["onsite", "hybrid", "remote"] as const;
export const RemoteTypeSchema = z.enum(REMOTE_TYPES);
export type RemoteType = z.infer<typeof RemoteTypeSchema>;

export const SENIORITY_LEVELS = ["intern", "junior", "mid", "senior", "staff", "principal", "manager"] as const;
export const SeniorityLevelSchema = z.enum(SENIORITY_LEVELS);
export type SeniorityLevel = z.infer<typeof SeniorityLevelSchema>;

export const SALARY_PERIODS = ["year", "month", "hour"] as const;
export const SalaryPeriodSchema = z.enum(SALARY_PERIODS);
export type SalaryPeriod = z.infer<typeof SalaryPeriodSchema>;

export const JOB_CHUNK_SECTIONS = ["requirements", "responsibilities", "about", "benefits", "other"] as const;
export const JobChunkSectionSchema = z.enum(JOB_CHUNK_SECTIONS);
export type JobChunkSection = z.infer<typeof JobChunkSectionSchema>;

export const RESUME_SECTIONS = [
  "summary",
  "experience",
  "projects",
  "skills",
  "education",
  "certifications",
  "other",
] as const;
export const ResumeSectionSchema = z.enum(RESUME_SECTIONS);
export type ResumeSection = z.infer<typeof ResumeSectionSchema>;

export const LLM_TIERS = ["local", "paid"] as const;
export const LlmTierSchema = z.enum(LLM_TIERS);
export type LlmTier = z.infer<typeof LlmTierSchema>;
