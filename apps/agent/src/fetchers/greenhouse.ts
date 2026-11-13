// Greenhouse public job-board API. The request shape and the location
// handling are adapted from career-ops (providers/greenhouse.mjs), MIT License,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See THIRD_PARTY_NOTICES.md.
import { z } from "zod";
import { htmlToText } from "../lib/html-to-text.ts";
import { mapValidItems, toDate } from "./parse-items.ts";
import type { Fetcher } from "./types.ts";

const HOST = "boards-api.greenhouse.io";

const BoardSchema = z.object({ jobs: z.array(z.unknown()) });

const JobSchema = z.object({
  id: z.union([z.number(), z.string().min(1)]),
  title: z.string().min(1),
  absolute_url: z.url(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  content: z.string().nullish(), // entity-escaped HTML
  first_published: z.string().nullish(),
  offices: z.array(z.object({ name: z.string().nullish() })).nullish(),
});

const WORK_MODEL = /^(?:hybrid|in[-\s]?office|on[-\s]?site|distributed|remote|flexible)$/i;

/** True for a location that names only a work model ("Hybrid", "Remote; Hybrid") and no place. */
export function isWorkModelOnly(location: string): boolean {
  const parts = location.split(";").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => WORK_MODEL.test(part));
}

// What boards write in location.name when a posting has no location.
const UNSTATED = /^(?:n\/?a|none|tbd)$/i;

// Some boards put the work model ("Hybrid") or nothing useful ("N/A") in
// location.name and keep the real place in offices[]. Only then are the
// office names used, sorted so the string is stable.
function resolveLocation(job: z.infer<typeof JobSchema>): string | null {
  const name = job.location?.name?.trim() ?? "";
  const offices = [...new Set((job.offices ?? []).map((office) => office.name?.trim()).filter((n): n is string => Boolean(n)))].sort();
  if (!name || UNSTATED.test(name)) return offices.length > 0 ? offices.join(" · ") : null;
  if (!isWorkModelOnly(name)) return name;
  return offices.length > 0 ? [name, ...offices].join(" · ") : name;
}

export const greenhouseFetcher: Fetcher = {
  ats: "greenhouse",

  // content=true puts every posting's body (and its offices) in the list
  // response: one request per board, no per-job detail calls.
  async fetch(company, { http }) {
    const url = `https://${HOST}/v1/boards/${encodeURIComponent(company.atsKey)}/jobs?content=true`;
    return http.getJson(url, { allowedHosts: [HOST] });
  },

  parse(payload) {
    const board = BoardSchema.parse(payload);
    const { jobs, skipped } = mapValidItems(JobSchema, board.jobs, (job) => {
      const description = htmlToText(job.content);
      if (!description) return null;
      return {
        externalId: String(job.id),
        url: job.absolute_url,
        title: job.title.trim(),
        location: resolveLocation(job),
        remoteType: null, // Greenhouse has no structured field for it
        description,
        postedAt: toDate(job.first_published),
        salary: null,
      };
    });
    return { jobs, sightings: [], skipped };
  },
};
