import type { ApplicationStatus } from "./status.ts";
import type { RequirementResult } from "./scoring.ts";

// Read models for the dashboard. Provisional: the jobs/matches tables are not
// designed yet, so these mirror CLAUDE.md's data model and will be revised
// together with the first migration.

export type RemoteType = "onsite" | "hybrid" | "remote";

export interface MatchSummary {
  jobId: string;
  company: string;
  title: string;
  location: string | null;
  remoteType: RemoteType | null;
  url: string;
  finalScore: number; // 0–100
  reason: string;
  status: ApplicationStatus;
  firstSeen: string; // ISO date
}

export interface MatchDetail extends MatchSummary {
  similarity: number; // cosine similarity, 0–1 (rescaled per run)
  llmScore: number; // 0–100, computed in code from the breakdown
  matchedSkills: string[];
  missingSkills: string[];
  breakdown: RequirementResult[];
}

export interface ApplicationRow {
  jobId: string;
  company: string;
  title: string;
  status: ApplicationStatus;
  appliedAt: string | null;
  nextFollowUpAt: string | null;
  notes: string | null;
}
