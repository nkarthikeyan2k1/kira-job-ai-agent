import { describe, expect, it } from "vitest";
import { greenhouseFetcher, isWorkModelOnly } from "./greenhouse.ts";
import { company, fakeHttp, fetchContext, fixture } from "./test-helpers.ts";

const stripe = company({ id: "stripe", name: "Stripe", atsKey: "stripe" });

describe("greenhouseFetcher.fetch", () => {
  it("requests the board once, with content, on the allowlisted host", async () => {
    const { http, requests } = fakeHttp(() => ({ jobs: [] }));

    await greenhouseFetcher.fetch(stripe, fetchContext(http));

    expect(requests).toEqual([
      { url: "https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true", request: { allowedHosts: ["boards-api.greenhouse.io"] } },
    ]);
  });
});

describe("greenhouseFetcher.parse", () => {
  it("maps a real board payload", () => {
    const { jobs, sightings, skipped } = greenhouseFetcher.parse(fixture("greenhouse-board.json"), stripe);

    expect(skipped).toBe(0);
    expect(sightings).toEqual([]);
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({
      externalId: "8262032",
      title: "Bridge Product Accountant",
      url: "https://stripe.com/jobs/search?gh_jid=8262032",
      location: "Bengaluru",
      remoteType: null,
      salary: null,
      postedAt: new Date("2026-10-09T01:54:16-04:00"),
    });
  });

  it("turns the double-encoded HTML body into structured plain text", () => {
    const { jobs } = greenhouseFetcher.parse(fixture("greenhouse-board.json"), stripe);

    for (const job of jobs) {
      expect(job.description).not.toMatch(/&lt;|&gt;|&amp;|<\/?[a-z]/i);
      expect(job.description.length).toBeGreaterThan(500);
    }
    expect(jobs[0]!.description.startsWith("Who we are\n\nAbout Stripe\n\n")).toBe(true);
    expect(jobs[0]!.description).toMatch(/^- \S/m); // list items survive as lines
  });

  it("skips postings that are malformed or have no description, without failing the board", () => {
    const valid = { id: 1, title: "Engineer", absolute_url: "https://example.com/1", content: "&lt;p&gt;Build&lt;/p&gt;" };
    const payload = { jobs: [valid, { ...valid, id: 2, absolute_url: undefined }, { ...valid, id: 3, content: "" }, "nonsense"] };

    const { jobs, skipped } = greenhouseFetcher.parse(payload, stripe);

    expect(jobs.map((job) => job.externalId)).toEqual(["1"]);
    expect(skipped).toBe(3);
  });

  it("adds office names when the location is only a work model", () => {
    const base = { id: 1, title: "Engineer", absolute_url: "https://example.com/1", content: "<p>Build</p>" };
    const payload = {
      jobs: [
        { ...base, location: { name: "Hybrid" }, offices: [{ name: "Bengaluru" }, { name: "Austin" }, { name: "Bengaluru" }] },
        { ...base, id: 2, location: { name: "Hybrid - London" }, offices: [{ name: "Dublin" }] },
        { ...base, id: 3, location: null },
      ],
    };

    const { jobs } = greenhouseFetcher.parse(payload, stripe);

    expect(jobs.map((job) => job.location)).toEqual(["Hybrid · Austin · Bengaluru", "Hybrid - London", null]);
  });

  it("uses the offices when the location is not stated", () => {
    const base = { id: 1, title: "Engineer", absolute_url: "https://example.com/1", content: "<p>Build</p>" };
    const payload = {
      jobs: [
        { ...base, location: { name: "N/A" }, offices: [{ name: "US" }] },
        { ...base, id: 2, location: { name: "na" }, offices: [{ name: "Canada Locations" }, { name: "US" }] },
        { ...base, id: 3, location: { name: "N/A" } },
        { ...base, id: 4, location: { name: "" }, offices: [{ name: "Dublin" }] },
      ],
    };

    const { jobs } = greenhouseFetcher.parse(payload, stripe);

    expect(jobs.map((job) => job.location)).toEqual(["US", "Canada Locations · US", null, "Dublin"]);
  });

  it("rejects a payload that is not a board", () => {
    expect(() => greenhouseFetcher.parse({ error: "not found" }, stripe)).toThrow();
  });
});

describe("isWorkModelOnly", () => {
  it("is true only when no place is named", () => {
    expect(isWorkModelOnly("Hybrid")).toBe(true);
    expect(isWorkModelOnly("Remote; Hybrid")).toBe(true);
    expect(isWorkModelOnly("Remote (India)")).toBe(false);
    expect(isWorkModelOnly("Bengaluru")).toBe(false);
  });
});
