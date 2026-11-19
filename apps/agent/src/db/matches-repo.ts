import { MatchSchema, parseRows, type HardFilterResult, type Match, type RequirementResult, type ScoreAdjustment } from "@kira/shared";
import type pg from "pg";

/** Whether a job has a current match, and whether that match already carries a score. */
export async function getCurrentMatchState(db: pg.Pool, jobId: string): Promise<{ exists: boolean; scored: boolean }> {
  const { rows } = await db.query<{ scored: boolean }>(
    "SELECT final_score IS NOT NULL AS scored FROM matches WHERE job_id = $1 AND is_current",
    [jobId],
  );
  return { exists: rows.length > 0, scored: rows[0]?.scored ?? false };
}

/**
 * Records a hard-filter result as the job's current match. matches is
 * append-only: the previous current row is kept and only loses its flag.
 */
export async function insertFilterMatch(db: pg.Pool, jobId: string, resumeVersionId: number, result: HardFilterResult): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE matches SET is_current = false WHERE job_id = $1 AND is_current", [jobId]);
    await client.query("INSERT INTO matches (job_id, resume_version_id, hard_filter_result) VALUES ($1, $2, $3)", [
      jobId,
      resumeVersionId,
      JSON.stringify(result),
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** The job's current match row, or null. */
export async function getCurrentMatch(db: pg.Pool, jobId: string): Promise<Match | null> {
  const { rows } = await db.query("SELECT * FROM matches WHERE job_id = $1 AND is_current", [jobId]);
  return parseRows(MatchSchema, rows)[0] ?? null;
}

export interface ScoredMatchInput {
  jobId: string;
  resumeVersionId: number;
  hardFilterResult: HardFilterResult;
  similarity: number | null;
  similarityNorm: number | null;
  llmScore: number | null;
  finalScore: number | null;
  breakdown: RequirementResult[];
  adjustments: ScoreAdjustment[];
  matchedSkills: string[];
  missingSkills: string[];
  reason: string;
  model: string;
  promptVersion: string;
}

/**
 * Appends a scored match as the job's new current match (the old row is kept
 * as history) and, when the score reaches the threshold and the job has no
 * application yet, creates one in status "shortlisted" with its first event.
 * All in one transaction.
 */
export async function insertScoredMatch(db: pg.Pool, m: ScoredMatchInput, shortlistThreshold: number): Promise<{ shortlisted: boolean }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE matches SET is_current = false WHERE job_id = $1 AND is_current", [m.jobId]);
    await client.query(
      `INSERT INTO matches (job_id, resume_version_id, hard_filter_result, similarity, similarity_norm, llm_score, final_score,
                            breakdown, adjustments, matched_skills, missing_skills, reason, model, prompt_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        m.jobId, m.resumeVersionId, JSON.stringify(m.hardFilterResult), m.similarity, m.similarityNorm, m.llmScore, m.finalScore,
        JSON.stringify(m.breakdown), JSON.stringify(m.adjustments), m.matchedSkills, m.missingSkills, m.reason, m.model, m.promptVersion,
      ],
    );

    let shortlisted = false;
    if (m.finalScore !== null && m.finalScore >= shortlistThreshold) {
      const application = await client.query<{ id: number }>(
        "INSERT INTO applications (job_id, status) VALUES ($1, 'shortlisted') ON CONFLICT (job_id) DO NOTHING RETURNING id",
        [m.jobId],
      );
      const id = application.rows[0]?.id;
      if (id !== undefined) {
        shortlisted = true;
        await client.query("INSERT INTO application_events (application_id, from_status, to_status, note) VALUES ($1, NULL, 'shortlisted', $2)", [
          id,
          `automatic: final score ${m.finalScore}`,
        ]);
      }
    }
    await client.query("COMMIT");
    return { shortlisted };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Jobs waiting for a score: open, not a duplicate, current match unscored and
 * either passed the hard filters or not enforced (manual). Manual jobs come
 * first and are all returned; the rest are the `topN` most similar.
 */
export async function listJobsToScore(db: pg.Pool, topN: number): Promise<string[]> {
  const { rows } = await db.query<{ id: string; manual: boolean }>(
    `SELECT j.id, j.source = 'manual' AS manual
       FROM matches m JOIN jobs j ON j.id = m.job_id
      WHERE m.is_current AND m.final_score IS NULL AND j.closed_at IS NULL AND j.duplicate_of IS NULL
        AND ((m.hard_filter_result->>'passed')::boolean OR NOT COALESCE((m.hard_filter_result->>'enforced')::boolean, true))
      ORDER BY (j.source = 'manual') DESC, m.similarity DESC NULLS LAST, j.id`,
  );
  const manual = rows.filter((row) => row.manual).map((row) => row.id);
  const automatic = rows.filter((row) => !row.manual).slice(0, topN).map((row) => row.id);
  return [...manual, ...automatic];
}
