import type { Profile } from "@kira/shared";
import type { FilterJob } from "./filters.ts";

/** A profile for tests: a mid-level web developer in India. */
export function testProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    targetRoles: ["Full Stack Developer"],
    skills: ["TypeScript", "Node.js"],
    experienceYears: 5,
    seniority: "mid",
    targetSeniority: ["mid", "senior"],
    titleKeywordsInclude: ["full stack", "backend", "software engineer"],
    titleKeywordsExclude: ["intern", "design engineer"],
    locations: ["Bengaluru", "Pune"],
    remoteTypes: ["onsite", "hybrid", "remote"],
    salaryMin: 1_400_000,
    salaryCurrency: "INR",
    workAuthCountries: ["India"],
    needsSponsorship: true,
    noticePeriodDays: 30,
    dealBreakers: [],
    updatedAt: new Date("2026-11-12T00:00:00Z"),
    ...overrides,
  };
}

/** A posting that passes every rule of testProfile(). */
export function testJob(overrides: Partial<FilterJob> = {}): FilterJob {
  return {
    source: "greenhouse",
    title: "Backend Engineer, Payments",
    location: "Bengaluru",
    remoteType: null,
    seniority: null,
    yearsMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    description: "Build payment services with Node.js.",
    ...overrides,
  };
}
