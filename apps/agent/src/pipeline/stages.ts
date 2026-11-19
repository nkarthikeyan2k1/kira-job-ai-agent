import type pg from "pg";
import type { Logger } from "pino";
import { FETCH_CONFIG } from "../../config/fetch.ts";
import { EMBEDDING } from "../../config/llm-routing.ts";
import { CHUNK_CONFIG, HARD_FILTER_CONFIG, SCORING_CONFIG, SIMILARITY_CONFIG } from "../../config/scoring.ts";
import { createLlmClient } from "../ai/llm-client.ts";
import { loadCompaniesConfig } from "../config/companies.ts";
import { createHttpClient } from "../fetchers/http.ts";
import { insertLlmCall } from "../db/llm-calls-repo.ts";
import { FETCHERS } from "../fetchers/registry.ts";
import { runDedupeFilterStage } from "./dedupe-filter-stage.ts";
import { runEmbedStage } from "./embed-stage.ts";
import { runScoreStage } from "./score-stage.ts";
import { runFetchStage } from "./fetch-stage.ts";
import type { Stage } from "./run.ts";

export interface StageContext {
  log: Logger;
  db: pg.Pool;
  ollamaUrl: string;
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
  {
    name: "embed", // [3] chunk + embed jobs and resume (nomic-embed-text, local), similarity per job
    async run({ db, log, ollamaUrl }) {
      const llm = createLlmClient({ ollamaUrl, recordCall: (call) => insertLlmCall(db, call) });
      await runEmbedStage({
        db,
        log,
        llm,
        settings: { tag: EMBEDDING.tag, chunk: CHUNK_CONFIG, embedSections: SIMILARITY_CONFIG.embedSections },
      });
    },
  },
  {
    name: "score", // [4] per-requirement evidence (local LLM) + [5] score in code; shortlist at the threshold
    async run({ db, log, ollamaUrl }) {
      const llm = createLlmClient({ ollamaUrl, recordCall: (call) => insertLlmCall(db, call) });
      await runScoreStage({ db, log, llm, config: SCORING_CONFIG, topN: SIMILARITY_CONFIG.topN });
    },
  },
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
