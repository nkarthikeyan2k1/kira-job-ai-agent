import { JobSchema, parseRows, type Job, type SeniorityLevel } from "@kira/shared";
import type pg from "pg";
import type { NewJob } from "../pipeline/normalize.ts";

// Every column of JobSchema. The embedding vector is deliberately left out:
// only the AI code reads it.
const JOB_COLUMNS = `id, company_id, source, external_id, url, url_normalized, fingerprint, title, location, location_norm,
  remote_type, seniority, years_min, salary_min, salary_max, salary_currency, salary_period, description,
  description_hash, posted_at, first_seen, last_seen, closed_at, duplicate_of, repost_of, embedding_model`;

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

export async function getJob(db: pg.Pool, jobId: string): Promise<Job | null> {
  const { rows } = await db.query(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = $1`, [jobId]);
  return parseRows(JobSchema, rows)[0] ?? null;
}

/** Every other job with the same fingerprint (same company, title and location). */
export async function getJobsWithFingerprint(db: pg.Pool, fingerprint: string, exceptJobId: string): Promise<Job[]> {
  const { rows } = await db.query(`SELECT ${JOB_COLUMNS} FROM jobs WHERE fingerprint = $1 AND id <> $2`, [fingerprint, exceptJobId]);
  return parseRows(JobSchema, rows);
}

export async function setDedupeLinks(db: pg.Pool, jobId: string, links: { duplicateOf: string | null; repostOf: string | null }): Promise<void> {
  await db.query("UPDATE jobs SET duplicate_of = $2, repost_of = $3 WHERE id = $1", [jobId, links.duplicateOf, links.repostOf]);
}

/** Saves the attributes read from a posting's own title and text. */
export async function setDerivedAttributes(
  db: pg.Pool,
  jobId: string,
  attributes: { seniority: SeniorityLevel | null; yearsMin: number | null },
): Promise<void> {
  await db.query("UPDATE jobs SET seniority = $2, years_min = $3 WHERE id = $1", [jobId, attributes.seniority, attributes.yearsMin]);
}

/** Open, non-duplicate jobs that stage [2] has not looked at yet. Oldest first, so an original is processed before its copies. */
export async function listUnfilteredJobIds(db: pg.Pool): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT j.id FROM jobs j
      WHERE j.closed_at IS NULL AND j.duplicate_of IS NULL
        AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.job_id = j.id AND m.is_current)
      ORDER BY j.first_seen, j.id`,
  );
  return rows.map((row) => row.id);
}

/** Open, non-duplicate jobs whose current match has no score yet: safe to filter again after the profile changes. */
export async function listUnscoredJobIds(db: pg.Pool): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT j.id FROM jobs j
      WHERE j.closed_at IS NULL AND j.duplicate_of IS NULL
        AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.job_id = j.id AND m.is_current AND m.final_score IS NOT NULL)
      ORDER BY j.first_seen, j.id`,
  );
  return rows.map((row) => row.id);
}

/** A copy whose original has closed becomes an ordinary job again, so it gets filtered on its own. */
export async function releaseDuplicatesOfClosedJobs(db: pg.Pool): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE jobs SET duplicate_of = NULL
      WHERE closed_at IS NULL AND duplicate_of IN (SELECT id FROM jobs WHERE closed_at IS NOT NULL)`,
  );
  return rowCount ?? 0;
}

/**
 * Closes a company's jobs that were missing from its last `missedRuns`
 * successful fetch runs, and adds the count to the latest run. Failed runs are
 * ignored, so an outage never closes anything; manual jobs are never closed.
 */
export async function closeStaleJobs(db: pg.Pool, companyId: string, missedRuns: number): Promise<number> {
  const runs = await db.query<{ id: number; started_at: Date }>(
    `SELECT id, started_at FROM fetch_runs
      WHERE company_id = $1 AND error IS NULL AND finished_at IS NOT NULL
      ORDER BY started_at DESC LIMIT $2`,
    [companyId, missedRuns],
  );
  if (runs.rows.length < missedRuns) return 0; // not enough history yet

  // A job seen in any of those runs has last_seen >= the oldest run's start.
  const cutoff = runs.rows.at(-1)!.started_at;
  const closed = await db.query(
    "UPDATE jobs SET closed_at = now() WHERE company_id = $1 AND closed_at IS NULL AND source <> 'manual' AND last_seen < $2",
    [companyId, cutoff],
  );
  const count = closed.rowCount ?? 0;
  if (count > 0) await db.query("UPDATE fetch_runs SET jobs_closed = jobs_closed + $2 WHERE id = $1", [runs.rows[0]!.id, count]);
  return count;
}
