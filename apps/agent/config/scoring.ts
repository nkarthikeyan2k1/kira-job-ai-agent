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
