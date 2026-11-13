import type pg from "pg";
import { getJob, getJobsWithFingerprint, setDedupeLinks } from "../db/jobs-repo.ts";
import { decideDedupe, type DedupeLinks } from "./dedupe.ts";

/**
 * Per-job dedupe: links the job to the stored original it duplicates and to a
 * closed posting it reposts. Safe to run again; the links are recomputed.
 */
export async function dedupeJob(db: pg.Pool, jobId: string): Promise<DedupeLinks> {
  const job = await getJob(db, jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const links = decideDedupe(job, await getJobsWithFingerprint(db, job.fingerprint, job.id));
  if (links.duplicateOf !== job.duplicateOf || links.repostOf !== job.repostOf) await setDedupeLinks(db, job.id, links);
  return links;
}
