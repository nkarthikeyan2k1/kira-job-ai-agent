import type pg from "pg";
import type { Logger } from "pino";
import { embedJob, embedResume, type EmbedSettings } from "../ai/embed.ts";
import { ModelInputError, ModelUnavailableError, type LlmClient } from "../ai/llm-client.ts";
import { normalizeSimilarities, similarityForJob } from "../ai/retrieve.ts";
import { listEmbeddedJobIds, listJobsToEmbed } from "../db/chunks-repo.ts";

export interface EmbedStageSummary {
  deferred: boolean; // Ollama was unavailable: the rest waits for the next run
  resumeChunksEmbedded: number;
  jobsEmbedded: number;
  jobsSkipped: number; // the model refused a job's input
  cuts: number; // sentences longer than a chunk that had to be cut
  similarities: number;
  basis: Record<string, number>;
}

/**
 * Stage [3]: embed the resume and every new or changed job, then (re)compute
 * each embedded job's similarity and rescale them all. The similarity pass
 * covers every embedded job, not only new ones: it is plain SQL, and a
 * re-embedded resume changes every job's similarity.
 */
export async function runEmbedStage(deps: { db: pg.Pool; log: Logger; llm: LlmClient; settings: EmbedSettings }): Promise<EmbedStageSummary> {
  const { db, log, llm, settings } = deps;
  const summary: EmbedStageSummary = {
    deferred: false,
    resumeChunksEmbedded: 0,
    jobsEmbedded: 0,
    jobsSkipped: 0,
    cuts: 0,
    similarities: 0,
    basis: {},
  };

  try {
    summary.resumeChunksEmbedded = (await embedResume(db, llm, settings.tag)).embedded;

    const jobIds = await listJobsToEmbed(db, settings.tag);
    log.info({ jobs: jobIds.length }, "embedding jobs");
    for (const [i, jobId] of jobIds.entries()) {
      try {
        await embedJob(db, llm, jobId, settings, (chars) => {
          summary.cuts++;
          log.warn({ jobId, chars }, "a sentence longer than a chunk was cut");
        });
        summary.jobsEmbedded++;
      } catch (err) {
        if (!(err instanceof ModelInputError)) throw err;
        summary.jobsSkipped++;
        log.warn({ jobId, err: err.message }, "model refused this job's input; skipped");
      }
      if ((i + 1) % 100 === 0) log.info({ done: i + 1, of: jobIds.length }, "embedding progress");
    }
  } catch (err) {
    if (!(err instanceof ModelUnavailableError)) throw err;
    summary.deferred = true;
    log.warn({ err: err.message }, "Ollama unavailable: embedding deferred to the next run");
  }

  for (const jobId of await listEmbeddedJobIds(db, settings.tag)) {
    const result = await similarityForJob(db, jobId);
    if (!result) continue;
    summary.similarities++;
    summary.basis[result.basis] = (summary.basis[result.basis] ?? 0) + 1;
  }
  const normalized = await normalizeSimilarities(db);

  log.info({ ...summary, normalized }, "embedding + similarity done");
  return summary;
}
