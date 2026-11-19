import type pg from "pg";
import type { Logger } from "pino";
import type { ScoringConfig } from "../../config/scoring.ts";
import { ModelInputError, ModelOutputError, ModelUnavailableError, type LlmClient } from "../ai/llm-client.ts";
import { listJobsToScore } from "../db/matches-repo.ts";
import { scoreJob } from "../scoring/score-job.ts";

export interface ScoreStageSummary {
  deferred: boolean; // Ollama was unavailable: the rest waits for the next run
  candidates: number;
  scored: number;
  shortlisted: number;
  failed: number; // the model's answer was unusable even after a retry, or the input was refused
}

/**
 * Stages [4] + [5]: score the most similar jobs that passed the hard filters
 * (plus every manual job). All job logic is in scoreJob; this is only the loop.
 */
export async function runScoreStage(deps: { db: pg.Pool; log: Logger; llm: LlmClient; config: ScoringConfig; topN: number }): Promise<ScoreStageSummary> {
  const { db, log, llm, config } = deps;
  const jobIds = await listJobsToScore(db, deps.topN);
  const summary: ScoreStageSummary = { deferred: false, candidates: jobIds.length, scored: 0, shortlisted: 0, failed: 0 };
  log.info({ jobs: jobIds.length }, "scoring jobs");

  for (const jobId of jobIds) {
    const started = performance.now();
    try {
      const outcome = await scoreJob(db, llm, jobId, config, {
        onCut: (chars) => log.warn({ jobId, chars, kept: config.maxJobChars }, "job text was longer than the limit and was cut"),
      });
      if (outcome.status !== "scored") continue;
      summary.scored++;
      if (outcome.shortlisted) summary.shortlisted++;
      log.info(
        { jobId, finalScore: outcome.finalScore, llmScore: outcome.llmScore, ms: Math.round(performance.now() - started), ...outcome.extraction.stats },
        "job scored",
      );
    } catch (err) {
      if (err instanceof ModelUnavailableError) {
        summary.deferred = true;
        log.warn({ err: err.message }, "Ollama unavailable: scoring deferred to the next run");
        break;
      }
      if (!(err instanceof ModelOutputError || err instanceof ModelInputError)) throw err;
      summary.failed++;
      log.warn({ jobId, err: err.message }, "could not score this job; it stays unscored and is retried next run");
    }
  }

  log.info(summary, "scoring done");
  return summary;
}
