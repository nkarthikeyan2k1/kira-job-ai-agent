import type { ApplicationRow, MatchDetail, MatchSummary } from "@kira/shared";
import { SAMPLE_APPLICATIONS, SAMPLE_MATCHES, SAMPLE_PROFILE, type Profile } from "./sample-data";

// Read side of the dashboard. Every function returns SAMPLE DATA for now and
// will query Postgres once the schema exists. Pages already wrap these calls
// in <Suspense>, so switching to real I/O needs no page changes.

export async function getShortlist(): Promise<MatchSummary[]> {
  return [...SAMPLE_MATCHES].sort((a, b) => b.finalScore - a.finalScore);
}

export async function getMatch(jobId: string): Promise<MatchDetail | null> {
  return SAMPLE_MATCHES.find((m) => m.jobId === jobId) ?? null;
}

export async function getApplications(): Promise<ApplicationRow[]> {
  return SAMPLE_APPLICATIONS;
}

export async function getProfile(): Promise<Profile> {
  return SAMPLE_PROFILE;
}
