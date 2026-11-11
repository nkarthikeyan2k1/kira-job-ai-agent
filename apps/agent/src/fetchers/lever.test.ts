import { describe, expect, it } from "vitest";
import { leverFetcher } from "./lever.ts";
import { company, fakeHttp, fetchContext, fixture } from "./test-helpers.ts";

const paytm = company({ id: "paytm", name: "Paytm", ats: "lever", atsKey: "paytm" });

const posting = {
  id: "abc-123",
  text: "Backend Engineer",
  hostedUrl: "https://jobs.lever.co/acme/abc-123",
  descriptionPlain: "Intro text",
  createdAt: 1_790_000_000_000,
};

describe("leverFetcher.fetch", () => {
  it("requests the whole board from the global host", async () => {
    const { http, requests } = fakeHttp(() => []);

    await leverFetcher.fetch(paytm, fetchContext(http));

    expect(requests[0]!.url).toBe("https://api.lever.co/v0/postings/paytm?mode=json");
    expect(requests[0]!.request.allowedHosts).toEqual(["api.lever.co"]);
  });

  it("uses the EU host when atsConfig.region is eu", async () => {
    const { http, requests } = fakeHttp(() => []);

    await leverFetcher.fetch(company({ ats: "lever", atsKey: "acme", atsConfig: { region: "eu" } }), fetchContext(http));

    expect(requests[0]!.url).toBe("https://api.eu.lever.co/v0/postings/acme?mode=json");
  });

  it("rejects an unknown region instead of guessing a host", async () => {
    const { http } = fakeHttp(() => []);

    await expect(leverFetcher.fetch(company({ ats: "lever", atsConfig: { region: "mars" } }), fetchContext(http))).rejects.toThrow();
  });
});

describe("leverFetcher.parse", () => {
  it("maps a real postings payload", () => {
    const { jobs, skipped } = leverFetcher.parse(fixture("lever-postings.json"), paytm);

    expect(skipped).toBe(0);
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({
      externalId: "9eed4fec-73f7-4114-a5d3-b2f689c92e8c",
      title: "Account Executive/ Director - AI Agentic Enterprise Sales",
      url: "https://jobs.lever.co/paytm/9eed4fec-73f7-4114-a5d3-b2f689c92e8c",
      location: "Dubai; Noida, Uttar Pradesh; Mumbai, Maharashtra", // primary + allLocations, no duplicate
      remoteType: "onsite",
      salary: null,
    });
    expect(jobs[0]!.postedAt).toEqual(new Date(1783043640931));
  });

  it("builds the description from the lists when the intro is empty", () => {
    const { jobs } = leverFetcher.parse(fixture("lever-postings.json"), paytm);

    expect(jobs[2]!.description.startsWith("Prefr (operated by CreditVidya)")).toBe(true);
    expect(jobs[2]!.description).not.toMatch(/<\/?[a-z]/i);
  });

  it("joins intro, lists and the closing block in page order", () => {
    const { jobs } = leverFetcher.parse(
      [{ ...posting, lists: [{ text: "Requirements", content: "<li>TypeScript</li><li>PostgreSQL</li>" }], additional: "<p>Equal opportunity employer.</p>" }],
      paytm,
    );

    expect(jobs[0]!.description).toBe("Intro text\n\nRequirements\n- TypeScript\n- PostgreSQL\n\nEqual opportunity employer.");
  });

  it("decodes entities even in Lever's 'plain' fields", () => {
    const { jobs } = leverFetcher.parse(
      [
        { ...posting, id: "html", description: "<div>R&amp;D team</div><div>It&#39;s remote</div>", descriptionPlain: "R&amp;D team\nIt&#39;s remote" },
        { ...posting, id: "plain-only", descriptionPlain: "R&amp;D team\nIt&#39;s remote" },
      ],
      paytm,
    );

    expect(jobs.map((job) => job.description)).toEqual(["R&D team\nIt's remote", "R&D team\nIt's remote"]);
  });

  it("maps workplaceType and treats 'unspecified' as unknown", () => {
    const types = ["remote", "hybrid", "on-site", "unspecified", undefined];

    const { jobs } = leverFetcher.parse(types.map((workplaceType, i) => ({ ...posting, id: `p${i}`, workplaceType })), paytm);

    expect(jobs.map((job) => job.remoteType)).toEqual(["remote", "hybrid", "onsite", null, null]);
  });

  it("keeps a salary only when the posting states a complete range", () => {
    const ranges = [
      { min: 3_000_000, max: 4_500_000.4, currency: "inr", interval: "per-year-salary" },
      { min: 50, max: 70, currency: "USD", interval: "per-hour-wage" },
      { min: 50, max: 70, currency: "USD", interval: "one-time" },
      { min: 90, max: 70, currency: "USD", interval: "per-year-salary" },
      { min: 50, currency: "USD", interval: "per-year-salary" },
    ];

    const { jobs } = leverFetcher.parse(ranges.map((salaryRange, i) => ({ ...posting, id: `p${i}`, salaryRange })), paytm);

    expect(jobs.map((job) => job.salary)).toEqual([
      { min: 3_000_000, max: 4_500_000, currency: "INR", period: "year" },
      { min: 50, max: 70, currency: "USD", period: "hour" },
      null,
      null,
      null,
    ]);
  });

  it("skips malformed postings and those without any text", () => {
    const { jobs, skipped } = leverFetcher.parse([posting, { ...posting, hostedUrl: "not a url" }, { ...posting, descriptionPlain: "" }, null], paytm);

    expect(jobs).toHaveLength(1);
    expect(skipped).toBe(3);
  });
});
