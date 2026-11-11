import type { AtsType, Company, RemoteType, SalaryPeriod } from "@kira/shared";
import type { Logger } from "pino";
import type { HttpClient } from "./http.ts";

/** One posting as its source describes it, before any normalization. */
export interface RawJob {
  externalId: string;
  url: string;
  title: string;
  location: string | null; // as the ATS states it
  remoteType: RemoteType | null; // only when the ATS has a field for it
  description: string; // plain text, line breaks kept
  postedAt: Date | null;
  // Only when the source states it in a structured field; never inferred from text.
  salary: { min: number; max: number; currency: string; period: SalaryPeriod } | null;
}

export interface ParseResult {
  jobs: RawJob[];
  /** Postings seen in a listing whose detail was not fetched (already stored): only last_seen is refreshed. */
  sightings: string[];
  /** Postings dropped because they failed validation. */
  skipped: number;
}

export interface FetchContext {
  http: HttpClient;
  /** External ids of this company's open jobs already in the database. */
  knownExternalIds: ReadonlySet<string>;
  log: Logger;
}

/**
 * One adapter per ATS. `fetch` does the network I/O and returns the payload
 * as received (it is archived before anything else happens); `parse` is pure,
 * so it is tested against saved payloads and can replay an archived one.
 */
export interface Fetcher {
  ats: AtsType;
  fetch(company: Company, ctx: FetchContext): Promise<unknown>;
  parse(payload: unknown, company: Company): ParseResult;
}
