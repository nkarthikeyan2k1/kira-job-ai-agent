import type { RequirementResult } from "@kira/shared";

// Checks applied in code to what the model said. The model is good at reading
// a posting but not trustworthy on details, so two things are enforced here
// instead of hoped for in the prompt.

// Wording that makes a requirement optional, whatever weight the model chose.
const NICE_WORDING = /\b(a plus|is a plus|plus point|preferred|preferably|nice to have|nice-to-have|good to have|bonus|desirable|advantageous|an advantage|optional)\b/i;

/** Normal form for quote matching: case, curly quotes, dashes, bullets and spacing don't matter. */
export function normalizeForQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/(^|\n)\s*[-•*]\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export interface VerifyStats {
  quotesDropped: number; // evidence not found in the resume
  downgraded: number; // "met" with no valid evidence → "partial"
  reweighted: number; // "must" whose wording says optional → "nice"
}

/**
 * - Evidence must be a real quote from the resume; otherwise it is dropped.
 * - "met" needs evidence: without a valid quote it becomes "partial".
 * - A requirement worded as optional is "nice" even if the model said "must".
 * - Duplicate requirements (same text) are kept once.
 */
export function verifyRequirements(results: readonly RequirementResult[], resumeText: string): { results: RequirementResult[]; stats: VerifyStats } {
  const resume = normalizeForQuote(resumeText);
  const stats: VerifyStats = { quotesDropped: 0, downgraded: 0, reweighted: 0 };
  const seen = new Set<string>();
  const verified: RequirementResult[] = [];

  for (const result of results) {
    const requirement = result.requirement.trim();
    const key = normalizeForQuote(requirement);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    let { evidence, status, weight } = result;
    if (evidence !== null) {
      const quote = normalizeForQuote(evidence);
      if (!quote || !resume.includes(quote)) {
        evidence = null;
        stats.quotesDropped++;
      }
    }
    if (status === "met" && evidence === null) {
      status = "partial";
      stats.downgraded++;
    }
    if (weight === "must" && NICE_WORDING.test(requirement)) {
      weight = "nice";
      stats.reweighted++;
    }
    verified.push({ requirement, weight, status, evidence });
  }
  return { results: verified, stats };
}
