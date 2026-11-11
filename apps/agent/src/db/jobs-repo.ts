import type pg from "pg";
import type { NewJob } from "../pipeline/normalize.ts";

const UNIQUE_VIOLATION = "23505";

export interface UpsertCounts {
  inserted: number;
  updated: number;
  /** Rows refused by a unique constraint (another job already owns that URL). */
  conflicts: number;
}

/** External ids of a company's open jobs. */
export async function getOpenExternalIds(db: pg.Pool, companyId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ external_id: string }>(
    "SELECT external_id FROM jobs WHERE company_id = $1 AND closed_at IS NULL",
    [companyId],
  );
  return new Set(rows.map((row) => row.external_id));
}

/**
 * Inserts new jobs and refreshes known ones. first_seen is never touched; a
 * job seen again is re-opened (closed_at cleared). When the description
 * changed, its embedding is cleared so the job is embedded again.
 */
export async function upsertJobs(db: pg.Pool, jobs: readonly NewJob[]): Promise<UpsertCounts> {
  const counts: UpsertCounts = { inserted: 0, updated: 0, conflicts: 0 };
  for (const job of jobs) {
    try {
      // In ON CONFLICT … SET, "jobs.x" is the stored value and "EXCLUDED.x" the new one.
      const { rows } = await db.query<{ inserted: boolean }>(
        `INSERT INTO jobs (id, company_id, source, external_id, url, url_normalized, fingerprint, title, location,
                           location_norm, remote_type, salary_min, salary_max, salary_currency, salary_period,
                           description, description_hash, posted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (id) DO UPDATE SET
           url = EXCLUDED.url, url_normalized = EXCLUDED.url_normalized, fingerprint = EXCLUDED.fingerprint,
           title = EXCLUDED.title, location = EXCLUDED.location, location_norm = EXCLUDED.location_norm,
           remote_type = EXCLUDED.remote_type, salary_min = EXCLUDED.salary_min, salary_max = EXCLUDED.salary_max,
           salary_currency = EXCLUDED.salary_currency, salary_period = EXCLUDED.salary_period,
           posted_at = COALESCE(EXCLUDED.posted_at, jobs.posted_at),
           embedding = CASE WHEN jobs.description_hash = EXCLUDED.description_hash THEN jobs.embedding END,
           embedding_model = CASE WHEN jobs.description_hash = EXCLUDED.description_hash THEN jobs.embedding_model END,
           description = EXCLUDED.description, description_hash = EXCLUDED.description_hash,
           last_seen = now(), closed_at = NULL
         RETURNING (xmax = 0) AS inserted`, // xmax = 0 only on a freshly inserted row
        [
          job.id, job.companyId, job.source, job.externalId, job.url, job.urlNormalized, job.fingerprint, job.title,
          job.location, job.locationNorm, job.remoteType, job.salaryMin, job.salaryMax, job.salaryCurrency,
          job.salaryPeriod, job.description, job.descriptionHash, job.postedAt,
        ],
      );
      if (rows[0]?.inserted) counts.inserted++;
      else counts.updated++;
    } catch (err) {
      if ((err as { code?: string }).code !== UNIQUE_VIOLATION) throw err;
      counts.conflicts++;
    }
  }
  return counts;
}

/** Refreshes last_seen for jobs seen in a listing whose detail was not fetched again. */
export async function touchJobs(db: pg.Pool, companyId: string, externalIds: readonly string[]): Promise<number> {
  if (externalIds.length === 0) return 0;
  const { rowCount } = await db.query(
    "UPDATE jobs SET last_seen = now(), closed_at = NULL WHERE company_id = $1 AND external_id = ANY($2::text[])",
    [companyId, externalIds],
  );
  return rowCount ?? 0;
}
