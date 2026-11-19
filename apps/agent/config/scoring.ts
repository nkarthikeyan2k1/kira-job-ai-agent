import type { SeniorityLevel } from "@kira/shared";

// Mechanics of the hard filters (stage [2]). What I want (titles, cities,
// salary floor…) lives in the profile row; how a posting is read lives here.
export const HARD_FILTER_CONFIG = {
  // A posting asking for more than my years + this many is filtered out.
  yearsOverTolerance: 1.5,
  // Larger numbers next to "years" are not experience requirements ("for 150 years").
  maxPlausibleYears: 30,

  // A job is closed when it was missing from this many successful fetch runs in a row.
  missedRunsBeforeClose: 2,

  // Spellings of the same place. Keys and values are matched as whole words,
  // case-insensitively, against a posting's location.
  placeAliases: {
    bengaluru: ["bengaluru", "bangalore"],
    gurugram: ["gurugram", "gurgaon"],
    mumbai: ["mumbai", "bombay"],
    delhi: ["delhi", "new delhi", "ncr"],
    chennai: ["chennai", "madras"],
    kochi: ["kochi", "cochin"],
    thiruvananthapuram: ["thiruvananthapuram", "trivandrum"],
    kolkata: ["kolkata", "calcutta"],
    pune: ["pune"],
    hyderabad: ["hyderabad"],
    coimbatore: ["coimbatore"],
    noida: ["noida"],
    ahmedabad: ["ahmedabad"],
    jaipur: ["jaipur"],
    india: ["india"],
  } as Record<string, readonly string[]>,

  // A country in the profile also covers these places, so "India" matches a
  // posting that only says "Pune, Maharashtra".
  countryPlaces: {
    india: [
      "bengaluru", "gurugram", "mumbai", "delhi", "chennai", "kochi", "thiruvananthapuram", "kolkata", "pune",
      "hyderabad", "coimbatore", "noida", "ahmedabad", "jaipur",
      "karnataka", "tamil nadu", "maharashtra", "telangana", "uttar pradesh", "haryana", "kerala", "gujarat", "west bengal",
    ],
  } as Record<string, readonly string[]>,

  // What boards write when a posting has no location. Treated as "not stated".
  unstatedLocations: ["n a", "na", "none", "tbd", "not specified", "multiple locations", "various"],

  // Words in a location that describe how, not where, the work happens.
  workModelWords: ["remote", "hybrid", "onsite", "on site", "in office", "work from home", "wfh", "anywhere", "distributed", "flexible"],

  // Level named in a job title. First match wins, so order matters:
  // "Senior Engineering Manager" is a manager, "Lead Engineer" is staff-level.
  seniorityTitlePatterns: [
    ["intern", /\b(intern|internship|trainee|apprentice|graduate|new grad|campus)\b/],
    ["manager", /\b(manager|head of|director|vp|vice president)\b/],
    ["principal", /\b(principal|distinguished|fellow|architect)\b/],
    ["staff", /\b(staff|lead)\b/],
    ["senior", /\b(senior|sr|iii|sde 3|sde3)\b/],
    ["junior", /\b(junior|jr|associate|entry level|fresher|sde 1|sde1)\b/],
    ["mid", /\b(ii|mid level|sde 2|sde2)\b/],
  ] as readonly (readonly [SeniorityLevel, RegExp])[],

  // Statements that a posting will not sponsor a visa. Plain "sponsor" is not
  // enough: postings also talk about "executive sponsors" and "sponsorships".
  noSponsorshipPhrases: [
    "unable to sponsor", "not able to sponsor", "cannot sponsor", "can not sponsor", "will not sponsor",
    "do not sponsor", "does not sponsor", "no sponsorship", "without sponsorship", "sponsorship is not available",
    "not eligible for sponsorship", "sponsorship not available", "must be authorized to work",
    "must be legally authorized to work", "must have the right to work", "must be eligible to work",
  ],
} as const;

export type HardFilterConfig = typeof HARD_FILTER_CONFIG;

// Stage [3]: how a job description is cut into chunks before embedding.
// 2,400 characters is about 780 tokens, well inside nomic-embed-text's 2,048.
export const CHUNK_CONFIG = {
  maxChars: 2400,
  minChars: 60, // smaller pieces are merged into the previous chunk of the same section
  headingMaxChars: 60,
  headingMaxWords: 8,
} as const;
export type ChunkConfig = typeof CHUNK_CONFIG;

export const SIMILARITY_CONFIG = {
  // Only these sections get vectors: "About us" and benefits are the same
  // boilerplate across a company's postings and would only add noise.
  embedSections: ["requirements", "responsibilities"],
  // How many of the most similar jobs go on to the LLM step (stage [4]).
  topN: 30,
} as const;

// Stages [4] + [5]: how the per-requirement breakdown becomes a score.
export interface ScoringConfig {
  mix: { similarity: number; llm: number };
  requirementWeight: Record<"must" | "nice", number>;
  statusValue: Record<"met" | "partial" | "missing", number>;
  shortlistThreshold: number;
  resumeContext: "full" | "retrieved";
  retrieveK: number;
  maxJobChars: number;
}

export const SCORING_CONFIG: ScoringConfig = {
  // final = mix.similarity · similarity_norm + mix.llm · llm_score/100 (start values; tune on the eval set)
  mix: { similarity: 0.4, llm: 0.6 },
  requirementWeight: { must: 2, nice: 1 },
  statusValue: { met: 1, partial: 0.5, missing: 0 },
  shortlistThreshold: 70, // final_score at or above → an application row is created (status "shortlisted")
  // "full": the whole resume goes in the prompt (it is small, ~1,100 tokens).
  // "retrieved": only the resume chunks closest to each requirements chunk (RAG), for when it grows.
  resumeContext: "full",
  retrieveK: 3,
  maxJobChars: 12_000, // requirements text sent to the model; more is cut and logged
};
