import { describe, expect, it } from "vitest";
import { company } from "../fetchers/test-helpers.ts";
import type { RawJob } from "../fetchers/types.ts";
import { fingerprint, jobId, normalizeJob, normalizeText } from "./normalize.ts";
import { normalizeUrl } from "./url.ts";

const raw: RawJob = {
  externalId: "8262032",
  url: "https://Stripe.com/jobs/search/?gh_jid=8262032&gh_src=abc#apply",
  title: "Senior Backend Engineer",
  location: "Bengaluru",
  remoteType: null,
  description: "Build payment systems.",
  postedAt: new Date("2026-10-09T05:54:16Z"),
  salary: null,
};
const stripe = company({ id: "stripe", name: "Stripe", ats: "greenhouse", atsKey: "stripe" });

describe("normalizeUrl", () => {
  it("lowercases the host and drops the fragment, tracking parameters and trailing slash", () => {
    expect(normalizeUrl("https://Stripe.com/jobs/search/?gh_jid=8262032&gh_src=abc&utm_source=x#apply")).toBe(
      "https://stripe.com/jobs/search?gh_jid=8262032",
    );
    expect(normalizeUrl("https://jobs.lever.co/paytm/abc-123?lever-source=LinkedIn")).toBe("https://jobs.lever.co/paytm/abc-123");
  });

  it("keeps meaningful parameters, in a stable order", () => {
    expect(normalizeUrl("https://example.com/job?b=2&a=1")).toBe(normalizeUrl("https://example.com/job?a=1&b=2"));
  });

  it("keeps the path's case: only the host is case-insensitive", () => {
    expect(normalizeUrl("https://example.com/job/BTWI_PE-A")).toBe("https://example.com/job/BTWI_PE-A");
  });
});

describe("normalizeText", () => {
  it("lowercases and removes accents, punctuation and extra spaces", () => {
    expect(normalizeText("  São Paulo,  BR ")).toBe("sao paulo br");
    expect(normalizeText("Sr. Engineer (Back-End)")).toBe("sr engineer back end");
  });
});

describe("jobId", () => {
  it("prefixes by source and includes the board key", () => {
    expect(jobId({ ats: "greenhouse", atsKey: "stripe" }, "8262032")).toBe("gh:stripe:8262032");
    expect(jobId({ ats: "lever", atsKey: "paytm" }, "abc-123")).toBe("lv:paytm:abc-123");
    expect(jobId({ ats: "peoplestrong", atsKey: "careers-bmwtechworks" }, "BTWI/PE/1")).toBe("ps:careers-bmwtechworks:BTWI/PE/1");
  });
});

describe("fingerprint", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(fingerprint("Stripe", "Senior Backend Engineer", "Bengaluru")).toBe(fingerprint("STRIPE", " senior  backend-engineer ", "bengaluru."));
  });

  it("changes with the company, the title or the location", () => {
    const base = fingerprint("Stripe", "Senior Backend Engineer", "Bengaluru");
    expect(fingerprint("Paytm", "Senior Backend Engineer", "Bengaluru")).not.toBe(base);
    expect(fingerprint("Stripe", "Staff Backend Engineer", "Bengaluru")).not.toBe(base);
    expect(fingerprint("Stripe", "Senior Backend Engineer", "Dublin")).not.toBe(base);
    expect(fingerprint("Stripe", "Senior Backend Engineer", null)).not.toBe(base);
  });
});

describe("normalizeJob", () => {
  it("builds the stored row from a raw job", () => {
    expect(normalizeJob(raw, stripe)).toEqual({
      id: "gh:stripe:8262032",
      companyId: "stripe",
      source: "greenhouse",
      externalId: "8262032",
      url: raw.url,
      urlNormalized: "https://stripe.com/jobs/search?gh_jid=8262032",
      fingerprint: fingerprint("Stripe", "Senior Backend Engineer", "Bengaluru"),
      title: "Senior Backend Engineer",
      location: "Bengaluru",
      locationNorm: "bengaluru",
      remoteType: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      description: "Build payment systems.",
      descriptionHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      postedAt: raw.postedAt,
    });
  });

  it("gives the same hash for the same description and a new one when it changes", () => {
    const first = normalizeJob(raw, stripe).descriptionHash;
    expect(normalizeJob({ ...raw }, stripe).descriptionHash).toBe(first);
    expect(normalizeJob({ ...raw, description: "Build payment systems!" }, stripe).descriptionHash).not.toBe(first);
  });

  it("prefers the source's remote field, then an explicit word in the location", () => {
    const remoteType = (job: Partial<RawJob>) => normalizeJob({ ...raw, ...job }, stripe).remoteType;

    expect(remoteType({ remoteType: "onsite", location: "Remote" })).toBe("onsite");
    expect(remoteType({ location: "Remote (India)" })).toBe("remote");
    expect(remoteType({ location: "Hybrid · Bengaluru" })).toBe("hybrid");
    expect(remoteType({ location: "Bengaluru" })).toBeNull(); // never assumed to be onsite
    expect(remoteType({ location: null })).toBeNull();
  });

  it("copies a stated salary", () => {
    const job = normalizeJob({ ...raw, salary: { min: 30, max: 45, currency: "INR", period: "year" } }, stripe);
    expect(job).toMatchObject({ salaryMin: 30, salaryMax: 45, salaryCurrency: "INR", salaryPeriod: "year" });
  });
});
