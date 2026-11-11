import type { AtsType } from "@kira/shared";
import type pg from "pg";
import type { Logger } from "pino";
import type { CompanyConfig } from "../config/companies.ts";
import { syncCompanies } from "../db/companies-repo.ts";
import { finishFetchRun, startFetchRun } from "../db/fetch-runs-repo.ts";
import { getOpenExternalIds, touchJobs, upsertJobs } from "../db/jobs-repo.ts";
import type { HttpClient } from "../fetchers/http.ts";
import type { Fetcher } from "../fetchers/types.ts";
import { normalizeJob } from "./normalize.ts";
import { pruneRawPayloads, saveRawPayload } from "./raw-store.ts";

export interface FetchStageDeps {
  db: pg.Pool;
  log: Logger;
  http: HttpClient;
  fetchers: Partial<Record<AtsType, Fetcher>>;
  companies: readonly CompanyConfig[];
  rawDir: string;
  rawRetentionDays: number;
  now?: () => Date;
}

export interface CompanyFetchResult {
  companyId: string;
  ats: AtsType;
  seen: number; // postings the source listed (stored + sightings)
  new: number;
  updated: number;
  skipped: number; // postings that failed validation or had no description
  error: string | null;
}

/**
 * Stage [1]: for every enabled company, fetch → archive raw payload → parse →
 * normalize → upsert. Each company runs in its own try/catch and gets a
 * fetch_runs row, so one failing source never stops the others.
 */
export async function runFetchStage(deps: FetchStageDeps): Promise<CompanyFetchResult[]> {
  const { db, log, http, fetchers, rawDir } = deps;
  const now = deps.now ?? (() => new Date());

  const removed = await pruneRawPayloads(rawDir, deps.rawRetentionDays, now());
  if (removed.length > 0) log.info({ removed }, "pruned old raw payloads");

  const companies = await syncCompanies(db, deps.companies);
  const results: CompanyFetchResult[] = [];

  for (const company of companies) {
    const fetcher = fetchers[company.ats];
    if (!fetcher) {
      log.warn({ company: company.id, ats: company.ats }, "no fetcher for this ATS yet; company skipped");
      continue;
    }

    const companyLog = log.child({ company: company.id });
    const result: CompanyFetchResult = { companyId: company.id, ats: company.ats, seen: 0, new: 0, updated: 0, skipped: 0, error: null };
    const runId = await startFetchRun(db, company.id);
    try {
      const knownExternalIds = await getOpenExternalIds(db, company.id);
      const payload = await fetcher.fetch(company, { http, knownExternalIds, log: companyLog });
      await saveRawPayload(rawDir, company.id, payload, now());

      const parsed = fetcher.parse(payload, company);
      const counts = await upsertJobs(db, parsed.jobs.map((job) => normalizeJob(job, company)));
      await touchJobs(db, company.id, parsed.sightings);

      result.seen = parsed.jobs.length + parsed.sightings.length;
      result.new = counts.inserted;
      result.updated = counts.updated;
      result.skipped = parsed.skipped + counts.conflicts;
      companyLog.info({ seen: result.seen, new: result.new, updated: result.updated, skipped: result.skipped }, "company fetched");
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      companyLog.error({ err }, "company fetch failed");
    }
    await finishFetchRun(db, runId, { jobsSeen: result.seen, jobsNew: result.new, error: result.error });
    results.push(result);
  }
  return results;
}
