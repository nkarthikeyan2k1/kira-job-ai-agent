// Lever public postings API. The description assembly and the location merge
// are adapted from career-ops (providers/lever.mjs), MIT License,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See THIRD_PARTY_NOTICES.md.
import type { RemoteType, SalaryPeriod } from "@kira/shared";
import { z } from "zod";
import { FETCH_CONFIG } from "../../config/fetch.ts";
import { htmlToText } from "../lib/html-to-text.ts";
import { mapValidItems, toDate } from "./parse-items.ts";
import type { Fetcher, RawJob } from "./types.ts";

/** `atsConfig` for a Lever company: EU-hosted boards live on a separate API host. */
export const LeverConfigSchema = z.object({ region: z.enum(["eu"]).optional() });

const HOSTS = { global: "api.lever.co", eu: "api.eu.lever.co" } as const;

const PostingSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  hostedUrl: z.url(),
  categories: z
    .object({
      location: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
    })
    .nullish(),
  description: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  lists: z.array(z.object({ text: z.string().nullish(), content: z.string().nullish() })).nullish(),
  additional: z.string().nullish(),
  additionalPlain: z.string().nullish(),
  createdAt: z.number().nullish(),
  workplaceType: z.string().nullish(),
  salaryRange: z
    .object({
      min: z.number().nullish(),
      max: z.number().nullish(),
      currency: z.string().nullish(),
      interval: z.string().nullish(),
    })
    .nullish(),
});
type Posting = z.infer<typeof PostingSchema>;

// `location` holds one primary city; multi-location postings list the rest in
// `allLocations`. Merge both, without duplicates.
function resolveLocation(categories: Posting["categories"]): string | null {
  const merged: string[] = [];
  for (const raw of [categories?.location, ...(categories?.allLocations ?? [])]) {
    const location = raw?.trim();
    if (location && !merged.some((seen) => seen.toLowerCase() === location.toLowerCase())) merged.push(location);
  }
  return merged.length > 0 ? merged.join("; ") : null;
}

// A posting's text is split across three fields: the intro, `lists` (where the
// requirements usually are) and the closing `additional` block. The HTML
// variant is preferred: the "Plain" fields can still carry entities (&amp;,
// &#39;), so they are only a fallback and are decoded too.
function resolveDescription(posting: Posting): string {
  const intro = htmlToText(posting.description) || htmlToText(posting.descriptionPlain);
  const lists = (posting.lists ?? []).map((list) => [htmlToText(list.text), htmlToText(list.content)].filter(Boolean).join("\n"));
  const closing = htmlToText(posting.additional) || htmlToText(posting.additionalPlain);
  return [intro, ...lists, closing].filter(Boolean).join("\n\n");
}

function resolveRemoteType(workplaceType: string | null | undefined): RemoteType | null {
  switch (workplaceType?.toLowerCase().replace(/[^a-z]/g, "")) {
    case "remote":
      return "remote";
    case "hybrid":
      return "hybrid";
    case "onsite":
      return "onsite";
    default:
      return null; // "unspecified" or absent
  }
}

function resolveSalary(range: Posting["salaryRange"]): RawJob["salary"] {
  if (!range || typeof range.min !== "number" || typeof range.max !== "number" || !range.currency) return null;
  if (range.currency.length !== 3 || range.min < 0 || range.max < range.min) return null;
  const interval = range.interval?.toLowerCase() ?? "";
  const period: SalaryPeriod | null = interval.includes("year") ? "year" : interval.includes("month") ? "month" : interval.includes("hour") ? "hour" : null;
  if (!period) return null;
  return { min: Math.round(range.min), max: Math.round(range.max), currency: range.currency.toUpperCase(), period };
}

export const leverFetcher: Fetcher = {
  ats: "lever",

  // The v0 endpoint returns the whole board, descriptions included, in one response.
  async fetch(company, { http }) {
    const { region } = LeverConfigSchema.parse(company.atsConfig);
    const host = region === "eu" ? HOSTS.eu : HOSTS.global;
    const url = `https://${host}/v0/postings/${encodeURIComponent(company.atsKey)}?mode=json`;
    return http.getJson(url, { allowedHosts: [host], timeoutMs: FETCH_CONFIG.leverTimeoutMs });
  },

  parse(payload) {
    const postings = z.array(z.unknown()).parse(payload);
    const { jobs, skipped } = mapValidItems(PostingSchema, postings, (posting) => {
      const description = resolveDescription(posting);
      if (!description) return null;
      return {
        externalId: posting.id,
        url: posting.hostedUrl,
        title: posting.text.trim(),
        location: resolveLocation(posting.categories),
        remoteType: resolveRemoteType(posting.workplaceType),
        description,
        postedAt: toDate(posting.createdAt),
        salary: resolveSalary(posting.salaryRange),
      };
    });
    return { jobs, sightings: [], skipped };
  },
};
