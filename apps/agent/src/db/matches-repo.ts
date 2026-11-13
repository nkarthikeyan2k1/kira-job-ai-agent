import type { HardFilterResult } from "@kira/shared";
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
