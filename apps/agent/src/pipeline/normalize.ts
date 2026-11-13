import { createHash } from "node:crypto";
import type { AtsType, Company, Job, RemoteType } from "@kira/shared";
import type { RawJob } from "../fetchers/types.ts";
import { normalizeUrl } from "./url.ts";

/** A job ready to be stored: every column the fetch stage fills. */
export type NewJob = Pick<
  Job,
  | "id" | "companyId" | "source" | "externalId" | "url" | "urlNormalized" | "fingerprint" | "title"
  | "location" | "locationNorm" | "remoteType" | "salaryMin" | "salaryMax" | "salaryCurrency"
  | "salaryPeriod" | "description" | "descriptionHash" | "postedAt"
>;

const ID_PREFIX: Record<AtsType, string> = {
  greenhouse: "gh",
  lever: "lv",
  ashby: "as",
  workday: "wd",
  peoplestrong: "ps",
  scrape: "sc",
  manual: "mn",
};

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Lowercase, accents removed, punctuation and repeated spaces collapsed: "São Paulo, BR" → "sao paulo br". */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function jobId(company: Pick<Company, "ats" | "atsKey">, externalId: string): string {
  return `${ID_PREFIX[company.ats]}:${company.atsKey}:${externalId}`;
}

/**
 * Same company + title + location → same fingerprint, whatever the source or
 * formatting. Used later to spot the same job on two boards and reposts.
 */
export function fingerprint(companyName: string, title: string, location: string | null): string {
  return sha256([companyName, title, location ?? ""].map(normalizeText).join("|"));
}

// Only an explicit word in the location counts; "onsite" is never assumed.
function remoteTypeFromLocation(location: string | null): RemoteType | null {
  if (!location) return null;
  if (/\bremote\b/i.test(location)) return "remote";
  if (/\bhybrid\b/i.test(location)) return "hybrid";
  return null;
}

/** Pure: RawJob (as the source describes it) → the row to store. No network, no database. */
export function normalizeJob(raw: RawJob, company: Company): NewJob {
  return {
    id: jobId(company, raw.externalId),
    companyId: company.id,
    source: company.ats,
    externalId: raw.externalId,
    url: raw.url,
    urlNormalized: normalizeUrl(raw.url),
    fingerprint: fingerprint(company.name, raw.title, raw.location),
    title: raw.title,
    location: raw.location,
    locationNorm: raw.location ? normalizeText(raw.location) : null,
    remoteType: raw.remoteType ?? remoteTypeFromLocation(raw.location),
    salaryMin: raw.salary?.min ?? null,
    salaryMax: raw.salary?.max ?? null,
    salaryCurrency: raw.salary?.currency ?? null,
    salaryPeriod: raw.salary?.period ?? null,
    description: raw.description,
    descriptionHash: sha256(raw.description),
    postedAt: raw.postedAt,
  };
}
