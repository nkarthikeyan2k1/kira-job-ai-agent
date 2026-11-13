import { describe, expect, it } from "vitest";
import { HARD_FILTER_CONFIG as config } from "../../config/scoring.ts";
import { evaluateHardFilters, HARD_FILTER_RULES, type FilterJob } from "./filters.ts";
import { testJob, testProfile } from "./test-fixtures.ts";
import type { Profile } from "@kira/shared";

const check = (rule: string, job: Partial<FilterJob>, profile: Partial<Profile> = {}) =>
  HARD_FILTER_RULES[rule]!(testJob(job), testProfile(profile), config).outcome;

describe("title rule", () => {
  it("needs one include keyword and no exclude keyword", () => {
    expect(check("title", { title: "Backend Engineer, Payments" })).toBe("pass");
    expect(check("title", { title: "Full-Stack Developer" })).toBe("pass"); // "full-stack" = "full stack"
    expect(check("title", { title: "Account Executive" })).toBe("fail");
    expect(check("title", { title: "Backend Engineering Intern" })).toBe("fail");
    expect(check("title", { title: "Design Engineer - BIW Parts" })).toBe("fail");
  });

  it("matches whole words, so 'intern' does not block 'Internal Tools'", () => {
    expect(check("title", { title: "Software Engineer, Internal Tools" })).toBe("pass");
  });

  it("passes any title when no include keywords are set", () => {
    expect(check("title", { title: "Account Executive" }, { titleKeywordsInclude: [] })).toBe("pass");
  });
});

describe("location rule", () => {
  it.each([
    ["Bengaluru", "pass"],
    ["Bangalore, Karnataka", "pass"],
    ["Noida, Uttar Pradesh; Bangalore, Karnataka", "pass"], // any listed city is enough
    ["Noida, Uttar Pradesh", "fail"],
    ["Remote", "pass"], // names no place
    ["Remote (India)", "pass"], // remote, in a country I can work in
    ["Remote - US", "fail"],
    ["Dublin or Germany (Berlin or Remote)", "fail"],
  ])("%s → %s", (location, outcome) => {
    expect(check("location", { location })).toBe(outcome);
  });

  it("cannot judge a posting without a location", () => {
    expect(check("location", { location: null })).toBe("unknown");
    expect(check("location", { location: "N/A" })).toBe("unknown"); // what some boards write instead of leaving it empty
  });

  it("does not treat an explicitly on-site job as remote because of its wording", () => {
    expect(check("location", { location: "Mumbai (remote-friendly team)", remoteType: "onsite" })).toBe("fail");
  });

  it("fails a work style I do not accept", () => {
    expect(check("location", { remoteType: "onsite" }, { remoteTypes: ["remote"] })).toBe("fail");
    expect(check("location", { location: "Remote" }, { remoteTypes: ["onsite"] })).toBe("fail");
  });
});

describe("seniority and years rules", () => {
  it("fails a level outside my targets and cannot judge an unnamed level", () => {
    expect(check("seniority", { seniority: "senior" })).toBe("pass");
    expect(check("seniority", { seniority: "staff" })).toBe("fail");
    expect(check("seniority", { seniority: null })).toBe("unknown");
  });

  it("allows a requirement up to my years plus the tolerance", () => {
    expect(check("years", { yearsMin: 6 })).toBe("pass"); // 5 + 1.5
    expect(check("years", { yearsMin: 7 })).toBe("fail");
    expect(check("years", { yearsMin: 2 })).toBe("pass"); // asking for less never fails
    expect(check("years", { yearsMin: null })).toBe("unknown");
  });
});

describe("visa rule", () => {
  const noSponsorship = "We are unable to sponsor visas for this role.";

  it("fails only when the posting refuses sponsorship and the job is outside my countries", () => {
    expect(check("visa", { description: noSponsorship, location: "Dublin" })).toBe("fail");
    expect(check("visa", { description: noSponsorship, location: "Pune, Maharashtra" })).toBe("pass");
    expect(check("visa", { description: noSponsorship, location: null })).toBe("unknown");
  });

  it("ignores other uses of the word sponsor", () => {
    expect(check("visa", { description: "Act as executive sponsor for strategic users.", location: "Dublin" })).toBe("pass");
  });
});

describe("salary and deal-breaker rules", () => {
  it("fails only a stated yearly salary in my currency that is below my floor", () => {
    const stated = { salaryCurrency: "INR", salaryPeriod: "year" } as const;
    expect(check("salary", { ...stated, salaryMax: 1_200_000 })).toBe("fail");
    expect(check("salary", { ...stated, salaryMax: 1_600_000 })).toBe("pass");
    expect(check("salary", { salaryMax: null })).toBe("unknown");
    expect(check("salary", { ...stated, salaryCurrency: "USD", salaryMax: 90_000 })).toBe("unknown");
    expect(check("salary", { ...stated, salaryPeriod: "month", salaryMax: 100_000 })).toBe("unknown");
  });

  it("fails a posting that mentions a deal-breaker phrase", () => {
    expect(check("dealBreakers", { description: "Rotational night shift required." }, { dealBreakers: ["night shift"] })).toBe("fail");
    expect(check("dealBreakers", { description: "Day shift." }, { dealBreakers: ["night shift"] })).toBe("pass");
    expect(check("dealBreakers", { description: "Rotational night shift required." })).toBe("pass"); // none set
  });
});

describe("evaluateHardFilters", () => {
  it("passes a matching job and lists what it could not check", () => {
    expect(evaluateHardFilters(testJob(), testProfile(), config)).toEqual({
      passed: true,
      enforced: true,
      failed: [],
      unknown: ["seniority", "years", "salary"],
    });
  });

  it("reports every failing rule with a reason", () => {
    const result = evaluateHardFilters(testJob({ title: "Staff Design Engineer", location: "Noida", seniority: "staff", yearsMin: 10 }), testProfile(), config);

    expect(result.passed).toBe(false);
    expect(result.failed).toEqual([
      { rule: "title", detail: 'title contains "design engineer"' },
      { rule: "location", detail: '"Noida" is not one of my locations' },
      { rule: "seniority", detail: "staff-level role; I target mid, senior" },
      { rule: "years", detail: "asks for 10+ years; I have 5" },
    ]);
  });

  it("checks a manual job the same way but does not enforce the result", () => {
    const result = evaluateHardFilters(testJob({ source: "manual", location: "Noida" }), testProfile(), config);

    expect(result).toMatchObject({ passed: false, enforced: false });
    expect(result.failed.map((f) => f.rule)).toEqual(["location"]);
  });
});
