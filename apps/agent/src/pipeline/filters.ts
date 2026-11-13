import type { HardFilterResult, Job, Profile } from "@kira/shared";
import type { HardFilterConfig } from "../../config/scoring.ts";
import { normalizeText } from "./normalize.ts";
import { expandPlaces, locationMatches, mentionsRemote, namesNoPlace } from "./places.ts";

// Stage [2] hard filters: cheap, deterministic checks that run before any
// embedding or LLM work. Each rule is a pure function of (job, profile).
// "unknown" means the posting lacks the data to decide; it never fails a job.

export type FilterJob = Pick<
  Job,
  | "source" | "title" | "location" | "remoteType" | "seniority" | "yearsMin"
  | "salaryMax" | "salaryCurrency" | "salaryPeriod" | "description"
>;

type Outcome = { outcome: "pass" } | { outcome: "unknown" } | { outcome: "fail"; detail: string };
type Rule = (job: FilterJob, profile: Profile, config: HardFilterConfig) => Outcome;

const PASS: Outcome = { outcome: "pass" };
const UNKNOWN: Outcome = { outcome: "unknown" };
const fail = (detail: string): Outcome => ({ outcome: "fail", detail });

const containsPhrase = (normalizedText: string, phrase: string) => ` ${normalizedText} `.includes(` ${normalizeText(phrase)} `);
const firstPhraseIn = (text: string, phrases: readonly string[]) => {
  const normalized = normalizeText(text);
  return phrases.find((phrase) => normalizeText(phrase) && containsPhrase(normalized, phrase));
};

const title: Rule = (job, profile) => {
  const excluded = firstPhraseIn(job.title, profile.titleKeywordsExclude);
  if (excluded) return fail(`title contains "${excluded}"`);
  if (profile.titleKeywordsInclude.length === 0) return PASS;
  return firstPhraseIn(job.title, profile.titleKeywordsInclude) ? PASS : fail("title matches none of my title keywords");
};

// On-site and hybrid jobs must be in a city I listed. A remote job is judged
// by country instead: it passes when it names no place, or a place where I
// can work without sponsorship.
const location: Rule = (job, profile, config) => {
  if (job.remoteType && profile.remoteTypes.length > 0 && !profile.remoteTypes.includes(job.remoteType)) {
    return fail(`${job.remoteType} work is not in my accepted work styles`);
  }
  if (!job.location || (config.unstatedLocations as readonly string[]).includes(normalizeText(job.location))) return UNKNOWN;

  if (locationMatches(job.location, expandPlaces(profile.locations, config))) return PASS;

  const remote = job.remoteType === "remote" || (job.remoteType === null && mentionsRemote(job.location));
  if (remote && (profile.remoteTypes.length === 0 || profile.remoteTypes.includes("remote"))) {
    if (namesNoPlace(job.location, config)) return PASS;
    if (locationMatches(job.location, expandPlaces(profile.workAuthCountries, config))) return PASS;
  }
  return fail(`"${job.location}" is not one of my locations`);
};

const seniority: Rule = (job, profile) => {
  if (!job.seniority) return UNKNOWN;
  if (profile.targetSeniority.length === 0 || profile.targetSeniority.includes(job.seniority)) return PASS;
  return fail(`${job.seniority}-level role; I target ${profile.targetSeniority.join(", ")}`);
};

const years: Rule = (job, profile, config) => {
  if (job.yearsMin === null || profile.experienceYears === null) return UNKNOWN;
  if (job.yearsMin <= profile.experienceYears + config.yearsOverTolerance) return PASS;
  return fail(`asks for ${job.yearsMin}+ years; I have ${profile.experienceYears}`);
};

const visa: Rule = (job, profile, config) => {
  const text = normalizeText(job.description);
  const phrase = config.noSponsorshipPhrases.find((p) => containsPhrase(text, p));
  if (!phrase) return PASS;
  if (!job.location) return UNKNOWN;
  if (locationMatches(job.location, expandPlaces(profile.workAuthCountries, config))) return PASS;
  return fail(`posting says "${phrase}" and "${job.location}" is outside ${profile.workAuthCountries.join(", ") || "my work-authorised countries"}`);
};

// Only a salary the posting states, per year and in my currency, can fail a job.
const salary: Rule = (job, profile) => {
  if (profile.salaryMin === null) return PASS;
  if (job.salaryMax === null || job.salaryPeriod !== "year" || job.salaryCurrency !== profile.salaryCurrency) return UNKNOWN;
  if (job.salaryMax >= profile.salaryMin) return PASS;
  return fail(`pays up to ${job.salaryMax} ${job.salaryCurrency}; my floor is ${profile.salaryMin}`);
};

const dealBreakers: Rule = (job, profile) => {
  const hit = firstPhraseIn(`${job.title}\n${job.description}`, profile.dealBreakers);
  return hit ? fail(`posting mentions "${hit}"`) : PASS;
};

export const HARD_FILTER_RULES: Readonly<Record<string, Rule>> = { title, location, seniority, years, visa, salary, dealBreakers };

/**
 * Runs every rule. A manual job (one I pasted) gets the same checks, but the
 * result is not enforced: its failures are shown and it is scored anyway.
 */
export function evaluateHardFilters(job: FilterJob, profile: Profile, config: HardFilterConfig): HardFilterResult {
  const failed: HardFilterResult["failed"] = [];
  const unknown: string[] = [];
  for (const [rule, check] of Object.entries(HARD_FILTER_RULES)) {
    const result = check(job, profile, config);
    if (result.outcome === "fail") failed.push({ rule, detail: result.detail });
    else if (result.outcome === "unknown") unknown.push(rule);
  }
  return { passed: failed.length === 0, enforced: job.source !== "manual", failed, unknown };
}
