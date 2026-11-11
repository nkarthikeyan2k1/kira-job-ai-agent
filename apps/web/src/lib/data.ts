import "server-only";
import {
  ApplicationRowSchema,
  MatchDetailSchema,
  MatchSummarySchema,
  ProfileSchema,
  parseRows,
  type ApplicationRow,
  type MatchDetail,
  type MatchSummary,
  type Profile,
} from "@kira/shared";
import { query } from "./db";

// Read side of the dashboard: SQL → camelCase → Zod. The web app only reads;
// writes go through the agent API.

const MATCH_SUMMARY_COLUMNS = `
  j.id AS job_id, c.name AS company, j.title, j.location, j.remote_type, j.url, j.first_seen,
  m.final_score, m.reason, COALESCE(a.status, 'scored') AS status`;

/** Jobs the agent shortlisted (it creates the applications row), best score first. */
export async function getShortlist(): Promise<MatchSummary[]> {
  const rows = await query(
    `SELECT ${MATCH_SUMMARY_COLUMNS}
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
       JOIN matches m ON m.job_id = j.id AND m.is_current AND m.final_score IS NOT NULL
      ORDER BY m.final_score DESC, j.first_seen DESC`,
  );
  return parseRows(MatchSummarySchema, rows);
}

/** Any scored job, shortlisted or not. */
export async function getMatch(jobId: string): Promise<MatchDetail | null> {
  const rows = await query(
    `SELECT ${MATCH_SUMMARY_COLUMNS},
            m.similarity, m.llm_score, m.matched_skills, m.missing_skills, m.breakdown
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       JOIN matches m ON m.job_id = j.id AND m.is_current AND m.final_score IS NOT NULL
       LEFT JOIN applications a ON a.job_id = j.id
      WHERE j.id = $1`,
    [jobId],
  );
  return parseRows(MatchDetailSchema, rows)[0] ?? null;
}

/** Applications that moved past the shortlist. */
export async function getApplications(): Promise<ApplicationRow[]> {
  const rows = await query(
    `SELECT a.job_id, a.status, a.applied_at, a.next_follow_up_at, a.notes, c.name AS company, j.title
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
      WHERE a.status <> 'shortlisted'
      ORDER BY COALESCE(a.applied_at, a.updated_at) DESC`,
  );
  return parseRows(ApplicationRowSchema, rows);
}

export async function getProfile(): Promise<Profile | null> {
  const rows = await query("SELECT * FROM profile WHERE id = 1");
  return parseRows(ProfileSchema, rows)[0] ?? null;
}
