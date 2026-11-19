import type pg from "pg";
import type { LlmCallRecord } from "../ai/llm-client.ts";

export async function insertLlmCall(db: pg.Pool, call: LlmCallRecord): Promise<void> {
  await db.query(
    `INSERT INTO llm_calls (task, tier, model, tokens_in, tokens_out, cost_usd, latency_ms, ok, error, job_id, prompt_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      call.task, call.tier, call.model, call.tokensIn, call.tokensOut, call.costUsd, call.latencyMs, call.ok, call.error,
      call.jobId, call.promptVersion,
    ],
  );
}
