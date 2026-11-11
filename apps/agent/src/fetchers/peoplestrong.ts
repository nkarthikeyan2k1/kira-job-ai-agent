// PeopleStrong candidate portal ({tenant}.peoplestrong.com), e.g. BMW TechWorks
// India. These are the portal's own public endpoints: they answer without a
// login, cookies or tokens. The listing carries no description, so each new
// posting costs one detail request.
import { z } from "zod";
import { FETCH_CONFIG } from "../../config/fetch.ts";
import { htmlToText } from "../lib/html-to-text.ts";
import { HttpError } from "./http.ts";
import { toDate } from "./parse-items.ts";
import type { Fetcher, RawJob } from "./types.ts";

// The portal's own spelling of the "description" part.
const DETAIL_PARTS = "basic,organisational,descriprion,skill,qualification";

const ListPageSchema = z.object({
  totalRecords: z.number().int().nonnegative(),
  response: z.array(z.unknown()),
});

const ListItemSchema = z.object({
  jobCode: z.string().min(1),
  jobTitle: z.string().min(1),
  jobDetailUrl: z.url(),
  jobPostedDate: z.string().nullish(),
  locationHierarchyComplete: z.string().nullish(),
  locationHierarchy: z.string().nullish(),
  expRange: z.string().nullish(),
});
type ListItem = z.infer<typeof ListItemSchema>;

// The detail response also names the hiring manager and their email. Only the
// fields below are kept: other people's personal data never reaches the
// archive or the database.
const DetailSchema = z.object({
  jobDescription: z.string().nullish(),
  minimumExp: z.string().nullish(),
  maximumExp: z.string().nullish(),
  employmentType: z.string().nullish(),
  skills: z.array(z.object({ text: z.string().nullish(), mandatory: z.boolean().nullish() })).nullish(),
  qualifications: z.array(z.string()).nullish(),
});
type Detail = z.infer<typeof DetailSchema>;

const PayloadSchema = z.object({
  list: z.array(z.unknown()),
  details: z.record(z.string(), z.unknown()),
});

/** "India>Karnataka>Bengaluru>Bengaluru" → "Bengaluru, Karnataka, India". */
export function formatLocation(hierarchy: string | null | undefined): string | null {
  const parts = (hierarchy ?? "").split(">").map((part) => part.trim()).filter(Boolean);
  const unique = parts.filter((part, index) => part !== parts[index - 1]);
  return unique.length > 0 ? unique.reverse().join(", ") : null;
}

// Experience, skills and qualifications are structured fields on the portal's
// page, not part of the description HTML; they are appended as plain lines so
// later stages see everything the posting states.
function buildDescription(item: ListItem, detail: Detail): string {
  const body = htmlToText(detail.jobDescription);
  if (!body) return "";
  const skills = (detail.skills ?? []).map((skill) => skill.text?.trim()).filter(Boolean);
  const extras = [
    item.expRange ? `Experience: ${item.expRange}` : null,
    detail.employmentType ? `Employment type: ${detail.employmentType}` : null,
    skills.length > 0 ? `Skills: ${skills.join(", ")}` : null,
    detail.qualifications?.length ? `Qualifications: ${detail.qualifications.join(", ")}` : null,
  ].filter(Boolean);
  return [body, extras.join("\n")].filter(Boolean).join("\n\n");
}

export const peoplestrongFetcher: Fetcher = {
  ats: "peoplestrong",

  async fetch(company, { http, knownExternalIds, log }) {
    const host = `${company.atsKey}.peoplestrong.com`;
    const base = `https://${host}/api/cp/rest/altone/cp`;
    const { pageSize, maxPages, maxDetailFetchesPerRun } = FETCH_CONFIG.peoplestrong;

    const list: unknown[] = [];
    for (let page = 0; page < maxPages; page++) {
      const raw = await http.getJson(`${base}/jobs/v1?offset=${page * pageSize}&limit=${pageSize}`, {
        allowedHosts: [host],
        method: "POST",
        body: {},
      });
      const { totalRecords, response } = ListPageSchema.parse(raw);
      list.push(...response);
      if (response.length === 0 || list.length >= totalRecords) break;
    }

    // Detail is fetched only for postings not stored yet. A stored posting
    // whose description changes later is therefore not picked up; the listing
    // has no "updated" field that could signal it.
    const details: Record<string, Detail> = {};
    let fetched = 0;
    for (const raw of list) {
      const item = ListItemSchema.safeParse(raw);
      if (!item.success || knownExternalIds.has(item.data.jobCode)) continue;
      if (fetched >= maxDetailFetchesPerRun) {
        log.warn({ limit: maxDetailFetchesPerRun }, "detail fetch limit reached; remaining new postings wait for the next run");
        break;
      }
      // The portal addresses a posting by the last segment of its detail URL.
      const slug = new URL(item.data.jobDetailUrl).pathname.split("/").filter(Boolean).pop();
      if (!slug) continue;
      fetched++;
      try {
        const detail = await http.getJson(`${base}/job/${encodeURIComponent(slug)}/v2?part=${DETAIL_PARTS}&isReqId=false`, {
          allowedHosts: [host],
        });
        const parsed = z.object({ response: DetailSchema }).safeParse(detail);
        if (parsed.success) details[item.data.jobCode] = parsed.data.response;
      } catch (err) {
        // One posting's detail failing must not lose the rest of the board.
        if (!(err instanceof HttpError)) throw err;
        log.warn({ jobCode: item.data.jobCode, status: err.status }, "job detail request failed; posting skipped this run");
      }
    }

    return { list, details };
  },

  parse(payload) {
    const { list, details } = PayloadSchema.parse(payload);
    const jobs: RawJob[] = [];
    const sightings: string[] = [];
    let skipped = 0;

    for (const raw of list) {
      const item = ListItemSchema.safeParse(raw);
      if (!item.success) {
        skipped++;
        continue;
      }
      // Listed but no detail fetched: an already-stored posting, seen again.
      if (!Object.hasOwn(details, item.data.jobCode)) {
        sightings.push(item.data.jobCode);
        continue;
      }
      const detail = DetailSchema.safeParse(details[item.data.jobCode]);
      const description = detail.success ? buildDescription(item.data, detail.data) : "";
      if (!description) {
        skipped++;
        continue;
      }
      jobs.push({
        externalId: item.data.jobCode,
        url: item.data.jobDetailUrl,
        title: item.data.jobTitle.trim(),
        location: formatLocation(item.data.locationHierarchyComplete) ?? item.data.locationHierarchy?.trim() ?? null,
        remoteType: null,
        description,
        postedAt: toDate(item.data.jobPostedDate),
        salary: null, // the portal reports 0 for salary on public postings
      });
    }
    return { jobs, sightings, skipped };
  },
};
