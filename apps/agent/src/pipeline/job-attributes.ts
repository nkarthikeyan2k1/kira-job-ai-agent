import type { SeniorityLevel } from "@kira/shared";
import type { HardFilterConfig } from "../../config/scoring.ts";
import { normalizeText } from "./normalize.ts";

/** The level a title names ("Senior", "Staff", "Intern"…); null when it names none. */
export function seniorityFromTitle(title: string, config: Pick<HardFilterConfig, "seniorityTitlePatterns">): SeniorityLevel | null {
  const normalized = normalizeText(title);
  for (const [level, pattern] of config.seniorityTitlePatterns) {
    if (pattern.test(normalized)) return level;
  }
  return null;
}

// "5+ years", "3-5 years", "2–12+ yrs", "8 to 12 years": group 1 is the lower bound.
const YEARS = /(?<!\d)(\d{1,2})\s*\+?\s*(?:(?:-|–|—|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b/gi;
// What follows a real requirement: "5+ years of…", "3 years experience", "4 yrs in…".
const REQUIREMENT_AFTER = /^\W{0,3}(?:of|in|experience|exp|hands|industry|professional|relevant|work|working|as|with|building|developing|leading|managing|total)\b/i;
// What precedes one: "Experience: 8-12 years", "minimum 5 years", "at least 3 years".
const REQUIREMENT_BEFORE = /(?:experience|minimum|min\.?|at least|atleast)\W{0,12}$/i;

/**
 * The minimum years of experience a posting asks for, read from its text;
 * null when it states none. A range counts by its lower bound ("3-5 years" → 3).
 * With several requirements the largest wins ("5+ years backend, 2+ years
 * leading" → 5): the candidate has to meet all of them.
 */
export function yearsMinFromDescription(description: string, config: Pick<HardFilterConfig, "maxPlausibleYears">): number | null {
  let years: number | null = null;
  for (const match of description.matchAll(YEARS)) {
    const lower = Number(match[1]);
    if (lower > config.maxPlausibleYears) continue;
    const after = description.slice(match.index + match[0].length, match.index + match[0].length + 24);
    const before = description.slice(Math.max(0, match.index - 24), match.index);
    if (!REQUIREMENT_AFTER.test(after) && !REQUIREMENT_BEFORE.test(before)) continue;
    years = Math.max(years ?? 0, lower);
  }
  return years;
}
