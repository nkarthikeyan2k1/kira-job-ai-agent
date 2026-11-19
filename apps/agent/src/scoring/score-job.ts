import type pg from "pg";
import type { ScoringConfig } from "../../config/scoring.ts";
import type { LlmClient } from "../ai/llm-client.ts";
import { getCurrentMatch, insertScoredMatch } from "../db/matches-repo.ts";
import { extractRequirements, type Extraction } from "./extract.ts";
import { computeFinalScore, computeLlmScore, summarizeBreakdown, type ScoreSummary } from "./score.ts";

export interface JobScore extends ScoreSummary {
  extraction: Extraction;
  similarity: number | null;
  similarityNorm: number | null;
  llmScore: number | null;
  finalScore: number | null;
}

export type ScoreJobOutcome =
  | ({ status: "scored"; shortlisted: boolean } & JobScore)
  | { status: "skipped"; reason: "not filtered yet" | "failed hard filters" | "already scored" };

/**
 * Computes a job's score without writing it (stages [4] + [5]): extraction by
 * the local model, then pure maths. The eval uses this directly.
 */
export async function computeJobScore(db: pg.Pool, llm: LlmClient, jobId: string, config: ScoringConfig, onCut?: (chars: number) => void): Promise<JobScore> {
  const current = await getCurrentMatch(db, jobId);
  const extraction = await extractRequirements(db, llm, jobId, config, onCut);
  const llmScore = computeLlmScore(extraction.breakdown, config);
  const similarityNorm = current?.similarityNorm ?? null;
  const summary = summarizeBreakdown(extraction.breakdown);
  return {
    ...summary,
    reason: llmScore === null ? "No requirements could be read from this posting." : summary.reason,
    extraction,
    similarity: current?.similarity ?? null,
    similarityNorm,
    llmScore,
    finalScore: computeFinalScore(similarityNorm, llmScore, config),
  };
}

/**
 * Per-job scoring, used by the pipeline stage and (later) by manual mode.
 * Only jobs that passed the hard filters, or whose result is not enforced
 * (manual jobs), are scored. The score is appended as a new current match;
 * at or above the threshold the job is shortlisted. `force` re-scores a job
 * that already has a score (e.g. after a prompt change).
 */
export async function scoreJob(
  db: pg.Pool,
  llm: LlmClient,
  jobId: string,
  config: ScoringConfig,
  options: { force?: boolean; onCut?: (chars: number) => void } = {},
): Promise<ScoreJobOutcome> {
  const current = await getCurrentMatch(db, jobId);
  if (!current) return { status: "skipped", reason: "not filtered yet" };
  if (!current.hardFilterResult.passed && current.hardFilterResult.enforced) return { status: "skipped", reason: "failed hard filters" };
  if (current.finalScore !== null && !options.force) return { status: "skipped", reason: "already scored" };

  const score = await computeJobScore(db, llm, jobId, config, options.onCut);
  const { shortlisted } = await insertScoredMatch(
    db,
    {
      jobId,
      resumeVersionId: score.extraction.resumeVersionId,
      hardFilterResult: current.hardFilterResult,
      similarity: score.similarity,
      similarityNorm: score.similarityNorm,
      llmScore: score.llmScore,
      finalScore: score.finalScore,
      breakdown: score.extraction.breakdown,
      adjustments: [],
      matchedSkills: score.matchedSkills,
      missingSkills: score.missingSkills,
      reason: score.reason,
      model: score.extraction.model,
      promptVersion: score.extraction.promptVersion,
    },
    config.shortlistThreshold,
  );
  return { status: "scored", shortlisted, ...score };
}
