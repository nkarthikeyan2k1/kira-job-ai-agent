import type { RequirementResult } from "@kira/shared";
import type { ScoringConfig } from "../../config/scoring.ts";

// Pure scoring: the same breakdown and similarity always give the same score.

/**
 * Weighted share of requirements met, 0–100. Must-haves count more than
 * nice-to-haves; "partial" counts for part. Null when there is nothing to score.
 */
export function computeLlmScore(breakdown: readonly RequirementResult[], config: ScoringConfig): number | null {
  let earned = 0;
  let possible = 0;
  for (const item of breakdown) {
    const weight = config.requirementWeight[item.weight];
    earned += weight * config.statusValue[item.status];
    possible += weight;
  }
  return possible === 0 ? null : Math.round((100 * earned) / possible);
}

/**
 * final = 100 × (w_sim · similarity_norm + w_llm · llm_score / 100), 0–100.
 * When one part is missing, the other carries the whole weight.
 */
export function computeFinalScore(similarityNorm: number | null, llmScore: number | null, config: ScoringConfig): number | null {
  if (similarityNorm === null && llmScore === null) return null;
  if (llmScore === null) return round1(100 * similarityNorm!);
  if (similarityNorm === null) return round1(llmScore);
  const { similarity, llm } = config.mix;
  return round1((100 * (similarity * similarityNorm + llm * (llmScore / 100))) / (similarity + llm));
}

const round1 = (n: number) => Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;

export interface ScoreSummary {
  matchedSkills: string[];
  missingSkills: string[];
  reason: string;
}

/** Lists and a one-line reason from the breakdown, without a model ("Meets 4 of 6 must-haves; missing: Java, Kafka"). */
export function summarizeBreakdown(breakdown: readonly RequirementResult[]): ScoreSummary {
  const musts = breakdown.filter((item) => item.weight === "must");
  const met = musts.filter((item) => item.status === "met").length;
  const partial = musts.filter((item) => item.status === "partial").length;
  const missingMust = musts.filter((item) => item.status === "missing").map((item) => item.requirement);

  const parts = [
    musts.length === 0 ? "No must-have requirements found" : `Meets ${met} of ${musts.length} must-haves${partial ? ` (${partial} partly)` : ""}`,
  ];
  if (missingMust.length > 0) parts.push(`missing: ${missingMust.slice(0, 3).join("; ")}${missingMust.length > 3 ? ` (+${missingMust.length - 3} more)` : ""}`);

  return {
    matchedSkills: breakdown.filter((item) => item.status !== "missing").map((item) => item.requirement),
    missingSkills: breakdown.filter((item) => item.status === "missing").map((item) => item.requirement),
    reason: `${parts.join("; ")}.`,
  };
}
