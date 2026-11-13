import type pg from "pg";
import type { Logger } from "pino";
import { FETCH_CONFIG } from "../../config/fetch.ts";
import { HARD_FILTER_CONFIG } from "../../config/scoring.ts";
import { loadCompaniesConfig } from "../config/companies.ts";
import { createHttpClient } from "../fetchers/http.ts";
import { FETCHERS } from "../fetchers/registry.ts";
import { runDedupeFilterStage } from "./dedupe-filter-stage.ts";
import { runFetchStage } from "./fetch-stage.ts";
import type { Stage } from "./run.ts";

export interface StageContext {
  log: Logger;
  db: pg.Pool;
}

// The run order from CLAUDE.md's architecture diagram. Stages still to be
// built are stubs.
export const PIPELINE_STAGES: readonly Stage<StageContext>[] = [
  {
    name: "fetch", // [1] one adapter per ATS, raw payloads kept 7 days; jobs are normalized before storing
    async run({ db, log }) {
      const results = await runFetchStage({
        db,
        log,
        http: createHttpClient({ userAgent: FETCH_CONFIG.userAgent, ...FETCH_CONFIG.http }),
        fetchers: FETCHERS,
        companies: await loadCompaniesConfig(),
        rawDir: FETCH_CONFIG.rawDir,
        rawRetentionDays: FETCH_CONFIG.rawRetentionDays,
      });
      log.info({ results }, "fetch summary");
    },
  },
  {
    name: "dedupe-filter", // [2] close stale jobs, link duplicates and reposts, hard filters; no LLM
    async run({ db, log }) {
      await runDedupeFilterStage({ db, log, config: HARD_FILTER_CONFIG });
    },
  },
  stub("embed"), // [3] nomic-embed-text → pgvector, top-N vs resume
  stub("extract"), // [4] per-requirement evidence, local LLM
  stub("score"), // [5] deterministic, threshold from config
  stub("liveness"), // [6] shortlist only
  stub("explain-tailor"), // [7] paid API, shortlist only
  stub("output"), // [8] digest email, export, tracker rows
];

function stub(name: string): Stage<StageContext> {
  return {
    name,
    async run({ log }) {
      log.warn("not implemented yet");
    },
  };
}
