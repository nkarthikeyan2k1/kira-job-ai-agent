import type { HardFilterResult } from "@kira/shared";
import type pg from "pg";
import type { HardFilterConfig } from "../../config/scoring.ts";
import { getJob, setDerivedAttributes } from "../db/jobs-repo.ts";
import { getCurrentMatchState, insertFilterMatch } from "../db/matches-repo.ts";
import { getProfile } from "../db/profile-repo.ts";
import { getActiveResumeVersionId } from "../db/resume-repo.ts";
import { evaluateHardFilters } from "./filters.ts";
import { seniorityFromTitle, yearsMinFromDescription } from "./job-attributes.ts";

/** Thrown when filtering cannot start because the profile or the resume has not been imported. */
export class FilterPrerequisiteError extends Error {
  override name = "FilterPrerequisiteError";
}

export type FilterJobOutcome = { status: "filtered"; result: HardFilterResult } | { status: "skipped"; reason: "already scored" };

/**
 * Per-job hard filter, used by the pipeline stage and (later) by manual mode:
 * reads the posting's seniority and required years from its own text, saves
 * them, runs the hard filters against my profile and records the result as
 * the job's current match.
 *
 * A job that already has a score is left alone: writing a filter-only match
 * would hide that score. Re-checking a scored job is the scoring step's job.
 */
export async function filterJob(db: pg.Pool, jobId: string, config: HardFilterConfig): Promise<FilterJobOutcome> {
  const [job, profile, resumeVersionId] = await Promise.all([getJob(db, jobId), getProfile(db), getActiveResumeVersionId(db)]);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (!profile) throw new FilterPrerequisiteError("No profile yet: fill apps/agent/data/profile.json and run `npm run profile:import`");
  if (resumeVersionId === null) throw new FilterPrerequisiteError("No active resume yet: run `npm run resume:import`");

  if ((await getCurrentMatchState(db, jobId)).scored) return { status: "skipped", reason: "already scored" };

  const derived = {
    seniority: seniorityFromTitle(job.title, config),
    yearsMin: yearsMinFromDescription(job.description, config),
  };
  if (derived.seniority !== job.seniority || derived.yearsMin !== job.yearsMin) await setDerivedAttributes(db, job.id, derived);

  const result = evaluateHardFilters({ ...job, ...derived }, profile, config);
  await insertFilterMatch(db, job.id, resumeVersionId, result);
  return { status: "filtered", result };
}
