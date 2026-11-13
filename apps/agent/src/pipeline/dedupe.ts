import type { Job } from "@kira/shared";

// Stage [2] dedupe: decides whether a stored job is a copy of another one.
// The decision is pure; dedupe-job.ts loads the candidates and saves the links.

export type DedupeJob = Pick<Job, "id" | "source" | "fingerprint" | "descriptionHash" | "firstSeen" | "closedAt" | "duplicateOf">;

export interface DedupeLinks {
  duplicateOf: string | null;
  repostOf: string | null;
}

/**
 * `others` are the other jobs with the same fingerprint (company + title +
 * location).
 *
 * - Duplicate: an older, open original exists on another source, or on the
 *   same source with an identical description. Two postings on one board with
 *   the same title but different text are different openings and both stay.
 * - Repost: an identical posting was closed before this one first appeared.
 */
export function decideDedupe(job: DedupeJob, others: readonly DedupeJob[]): DedupeLinks {
  const sameJob = (other: DedupeJob) => other.source !== job.source || other.descriptionHash === job.descriptionHash;
  const older = (other: DedupeJob) =>
    other.firstSeen < job.firstSeen || (other.firstSeen.getTime() === job.firstSeen.getTime() && other.id < job.id);

  const originals = others
    .filter((other) => other.closedAt === null && other.duplicateOf === null && sameJob(other) && older(other))
    .sort((a, b) => a.firstSeen.getTime() - b.firstSeen.getTime() || a.id.localeCompare(b.id));

  const closedBefore = others
    .filter((other) => other.closedAt !== null && other.closedAt < job.firstSeen)
    .sort((a, b) => b.closedAt!.getTime() - a.closedAt!.getTime());

  return { duplicateOf: originals[0]?.id ?? null, repostOf: closedBefore[0]?.id ?? null };
}
