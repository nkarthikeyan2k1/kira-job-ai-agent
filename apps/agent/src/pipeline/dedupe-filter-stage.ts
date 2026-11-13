import type pg from "pg";
import type { Logger } from "pino";
import type { HardFilterConfig } from "../../config/scoring.ts";
import { closeStaleJobs, listUnfilteredJobIds, releaseDuplicatesOfClosedJobs } from "../db/jobs-repo.ts";
import { dedupeJob } from "./dedupe-job.ts";
import { filterJob } from "./filter-job.ts";

export interface DedupeFilterSummary {
  closed: number;
  duplicates: number;
  reposts: number;
  passed: number;
  failed: number;
  /** How many jobs each rule failed (a job can fail several). */
  failedByRule: Record<string, number>;
}

/**
 * Stage [2]: close stale jobs, then dedupe and hard-filter every job this
 * stage has not seen yet. All job logic is in the per-job functions; this is
 * only the loop.
 */
export async function runDedupeFilterStage(
  deps: { db: pg.Pool; log: Logger; config: HardFilterConfig },
  jobIds?: readonly string[],
): Promise<DedupeFilterSummary> {
  const { db, log, config } = deps;
  const summary: DedupeFilterSummary = { closed: 0, duplicates: 0, reposts: 0, passed: 0, failed: 0, failedByRule: {} };

  const companies = await db.query<{ id: string }>("SELECT id FROM companies WHERE enabled");
  for (const company of companies.rows) summary.closed += await closeStaleJobs(db, company.id, config.missedRunsBeforeClose);
  await releaseDuplicatesOfClosedJobs(db);

  for (const jobId of jobIds ?? (await listUnfilteredJobIds(db))) {
    const links = await dedupeJob(db, jobId);
    if (links.repostOf) summary.reposts++;
    if (links.duplicateOf) {
      summary.duplicates++;
      continue; // the original carries the match
    }

    const outcome = await filterJob(db, jobId, config);
    if (outcome.status !== "filtered") continue;
    if (outcome.result.passed) summary.passed++;
    else summary.failed++;
    for (const { rule } of outcome.result.failed) summary.failedByRule[rule] = (summary.failedByRule[rule] ?? 0) + 1;
  }

  log.info(summary, "dedupe + hard filters done");
  return summary;
}
