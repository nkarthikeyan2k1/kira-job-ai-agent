import type { Stage } from "./run.ts";

// The run order from CLAUDE.md's architecture diagram. Every stage is a stub
// until it is designed and built.
export const PIPELINE_STAGES: readonly Stage[] = [
  stub("fetch"), // [1] one adapter per ATS, raw JSON kept 7 days
  stub("normalize-dedupe-filter"), // [2] no LLM
  stub("embed"), // [3] nomic-embed-text → pgvector, top-N vs resume
  stub("extract"), // [4] per-requirement evidence, local LLM
  stub("score"), // [5] deterministic, threshold from config
  stub("liveness"), // [6] shortlist only
  stub("explain-tailor"), // [7] paid API, shortlist only
  stub("output"), // [8] digest email, export, tracker rows
];

function stub(name: string): Stage {
  return {
    name,
    async run({ log }) {
      log.warn("not implemented yet");
    },
  };
}
