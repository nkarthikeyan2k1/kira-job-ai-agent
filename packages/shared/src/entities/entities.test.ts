import { describe, expect, it } from "vitest";
import { APPLICATION_STATUSES, JOB_STATUSES } from "../enums.ts";
import { ApplicationSchema } from "./application.ts";
import { JobSchema } from "./job.ts";
import { LlmCallSchema } from "./llm-call.ts";
import { MatchSchema } from "./match.ts";

const now = new Date("2026-11-11T00:00:00Z");

const job = {
  id: "gh:acme:1",
  companyId: "acme",
  source: "greenhouse",
  externalId: "1",
  url: "https://example.com/jobs/1",
  urlNormalized: "example.com/jobs/1",
  fingerprint: "abc",
  title: "Senior Engineer",
  location: null,
  locationNorm: null,
  remoteType: "remote",
  seniority: null,
  yearsMin: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
  description: "Build things.",
  descriptionHash: "def",
  postedAt: null,
  firstSeen: now,
  lastSeen: now,
  closedAt: null,
  embeddingModel: null,
};

describe("entity schemas", () => {
  it("accepts a valid job row", () => {
    expect(JobSchema.parse(job)).toEqual(job);
  });

  it("rejects values outside an enum", () => {
    expect(JobSchema.safeParse({ ...job, remoteType: "office" }).success).toBe(false);
    expect(JobSchema.safeParse({ ...job, source: "linkedin" }).success).toBe(false);
  });

  it("stores only shortlisted-and-later statuses on an application", () => {
    const application = {
      id: 1,
      jobId: "gh:acme:1",
      status: "applied",
      appliedAt: now,
      nextFollowUpAt: null,
      followUpCount: 0,
      resumePath: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
    };
    expect(ApplicationSchema.safeParse(application).success).toBe(true);
    expect(ApplicationSchema.safeParse({ ...application, status: "found" }).success).toBe(false);
    expect(JOB_STATUSES).toEqual(["found", "scored", ...APPLICATION_STATUSES]);
  });

  it("allows a hard-filtered match with no scores", () => {
    const filtered = {
      id: 1,
      jobId: "gh:acme:1",
      resumeVersionId: 1,
      isCurrent: true,
      hardFilterResult: { passed: false, failed: [{ rule: "location", detail: "onsite in Berlin" }] },
      similarity: null,
      similarityNorm: null,
      llmScore: null,
      finalScore: null,
      breakdown: [],
      adjustments: [],
      matchedSkills: [],
      missingSkills: [],
      reason: null,
      model: null,
      promptVersion: null,
      scoredAt: now,
    };
    expect(MatchSchema.safeParse(filtered).success).toBe(true);
    expect(MatchSchema.safeParse({ ...filtered, finalScore: 140 }).success).toBe(false);
  });

  it("coerces Postgres numeric strings to numbers", () => {
    const call = LlmCallSchema.parse({
      id: 1,
      task: "explain",
      tier: "paid",
      model: "m",
      tokensIn: 10,
      tokensOut: 5,
      costUsd: "0.001250",
      latencyMs: 900,
      ok: true,
      error: null,
      jobId: null,
      promptVersion: null,
      createdAt: now,
    });
    expect(call.costUsd).toBe(0.00125);
  });
});
