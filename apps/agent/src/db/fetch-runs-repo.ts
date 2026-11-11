import type pg from "pg";

export async function startFetchRun(db: pg.Pool, companyId: string): Promise<number> {
  const { rows } = await db.query<{ id: number }>("INSERT INTO fetch_runs (company_id) VALUES ($1) RETURNING id", [companyId]);
  return rows[0]!.id;
}

export async function finishFetchRun(
  db: pg.Pool,
  runId: number,
  result: { jobsSeen: number; jobsNew: number; error: string | null },
): Promise<void> {
  await db.query("UPDATE fetch_runs SET finished_at = now(), jobs_seen = $2, jobs_new = $3, error = $4 WHERE id = $1", [
    runId,
    result.jobsSeen,
    result.jobsNew,
    result.error,
  ]);
}
