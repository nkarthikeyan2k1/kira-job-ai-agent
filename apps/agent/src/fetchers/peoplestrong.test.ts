import { describe, expect, it } from "vitest";
import { HttpError } from "./http.ts";
import { formatLocation, peoplestrongFetcher } from "./peoplestrong.ts";
import { company, fakeHttp, fetchContext, fixture } from "./test-helpers.ts";

const bmw = company({ id: "bmw-techworks", name: "BMW TechWorks India", ats: "peoplestrong", atsKey: "careers-bmwtechworks" });
const HOST = "careers-bmwtechworks.peoplestrong.com";
const BASE = `https://${HOST}/api/cp/rest/altone/cp`;
const KNOWN = "BTWI/DE-PEP/1914042"; // second posting in the list fixture
const NEW = "BTWI/PE-A-SH/1738338";

const listPage = fixture("peoplestrong-list-page.json");
const detail = fixture("peoplestrong-detail.json");

function portal() {
  return fakeHttp((url) => (url.includes("/jobs/v1?") ? listPage : detail));
}

describe("peoplestrongFetcher.fetch", () => {
  it("lists the board, then fetches detail only for postings not stored yet", async () => {
    const { http, requests } = portal();

    await peoplestrongFetcher.fetch(bmw, fetchContext(http, [KNOWN]));

    expect(requests.map((r) => r.url)).toEqual([
      `${BASE}/jobs/v1?offset=0&limit=200`,
      `${BASE}/job/BTWI_PE-A-SH_1738338/v2?part=basic,organisational,descriprion,skill,qualification&isReqId=false`,
    ]);
    expect(requests[0]!.request).toEqual({ allowedHosts: [HOST], method: "POST", body: {} });
    expect(requests[1]!.request).toEqual({ allowedHosts: [HOST] });
  });

  it("keeps only whitelisted detail fields, so personal data is never archived", async () => {
    const { http } = portal();

    const payload = (await peoplestrongFetcher.fetch(bmw, fetchContext(http, [KNOWN]))) as { details: Record<string, object> };

    expect(JSON.stringify(detail)).toContain("hiringManagerName"); // the source does send it
    expect(Object.keys(payload.details)).toEqual([NEW]);
    expect(Object.keys(payload.details[NEW]!).sort()).toEqual(["employmentType", "jobDescription", "maximumExp", "minimumExp", "qualifications", "skills"]);
  });

  it("pages through the listing until every record is read", async () => {
    const [first, second] = (listPage as { response: unknown[] }).response;
    const { http, requests } = fakeHttp((url) =>
      url.includes("offset=0") ? { totalRecords: 2, response: [first] } : { totalRecords: 2, response: [second] },
    );

    const payload = (await peoplestrongFetcher.fetch(bmw, fetchContext(http, [NEW, KNOWN]))) as { list: unknown[] };

    expect(requests.map((r) => r.url)).toEqual([`${BASE}/jobs/v1?offset=0&limit=200`, `${BASE}/jobs/v1?offset=200&limit=200`]);
    expect(payload.list).toHaveLength(2);
  });

  it("keeps going when one posting's detail request fails", async () => {
    const { http } = fakeHttp((url) => {
      if (url.includes("/jobs/v1?")) return listPage;
      if (url.includes("BTWI_PE-A-SH_1738338")) throw new HttpError(404, null, url);
      return detail;
    });

    const payload = (await peoplestrongFetcher.fetch(bmw, fetchContext(http))) as { details: Record<string, unknown> };

    expect(Object.keys(payload.details)).toEqual([KNOWN]);
  });
});

describe("peoplestrongFetcher.parse", () => {
  it("builds a job from list + detail, and reports stored postings as sightings", async () => {
    const { http } = portal();
    const payload = await peoplestrongFetcher.fetch(bmw, fetchContext(http, [KNOWN]));

    const { jobs, sightings, skipped } = peoplestrongFetcher.parse(payload, bmw);

    expect(skipped).toBe(0);
    expect(sightings).toEqual([KNOWN]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      externalId: NEW,
      title: "Principal Engineer / Architect - System Health",
      url: `https://${HOST}/job/detail/BTWI_PE-A-SH_1738338`,
      location: "Bengaluru, Karnataka, India",
      remoteType: null,
      salary: null,
      postedAt: new Date("2026-11-04"),
    });
  });

  it("appends the structured experience, skills and qualifications to the description", async () => {
    const { http } = portal();
    const payload = await peoplestrongFetcher.fetch(bmw, fetchContext(http, [KNOWN]));

    const description = peoplestrongFetcher.parse(payload, bmw).jobs[0]!.description;

    expect(description.startsWith("Principal Engineer / Architect — System Health\n\n")).toBe(true);
    expect(description).toContain("\n\nExperience: 8-12 years\n");
    expect(description).toContain("Skills: Linux, C++, Recovery, Embedded Systems, Android");
    expect(description).toContain("Qualifications: B.Tech/BE");
    expect(description).not.toMatch(/REDACTED|redacted@example\.com/);
  });

  it("skips a posting whose detail has no description", () => {
    const { response } = listPage as { response: unknown[] };

    const { jobs, skipped } = peoplestrongFetcher.parse({ list: response.slice(0, 1), details: { [NEW]: { jobDescription: "" } } }, bmw);

    expect(jobs).toEqual([]);
    expect(skipped).toBe(1);
  });
});

describe("formatLocation", () => {
  it("reverses the hierarchy and drops the repeated city", () => {
    expect(formatLocation("India>Karnataka>Bengaluru>Bengaluru")).toBe("Bengaluru, Karnataka, India");
    expect(formatLocation("India")).toBe("India");
    expect(formatLocation("")).toBeNull();
    expect(formatLocation(null)).toBeNull();
  });
});
