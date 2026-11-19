import { pino } from "pino";
import { SCORING_CONFIG } from "../../config/scoring.ts";
import { createLlmClient, ModelUnavailableError } from "../ai/llm-client.ts";
import { PROMPT_VERSION } from "../ai/prompts/extract-requirements.ts";
import { createPool } from "../db/client.ts";
import { insertLlmCall } from "../db/llm-calls-repo.ts";
import { loadEnv } from "../env.ts";
import { evalMetrics, type EvalRow } from "./eval-metrics.ts";
import { readLabels } from "./labels.ts";
import { computeJobScore } from "./score-job.ts";

// `npm run eval`: scores every labelled job with the current prompt, model and
// weights (nothing is written to matches) and compares with my labels.
// Run it after any change to prompts, models, weights or threshold, and paste
// the summary line into PROGRESS.md. `-- --limit=10` for a quick check.
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? Infinity);
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL });
const db = createPool(env.DATABASE_URL);
const llm = createLlmClient({ ollamaUrl: env.OLLAMA_URL, recordCall: (call) => insertLlmCall(db, call) });

try {
  const labels = (await readLabels()).slice(0, LIMIT);
  if (labels.length === 0) throw new Error("No labels yet: run `npm run eval:label` first");

  const rows: (EvalRow & { title: string; llmScore: number | null })[] = [];
  for (const [i, label] of labels.entries()) {
    const started = performance.now();
    try {
      const score = await computeJobScore(db, llm, label.jobId, SCORING_CONFIG);
      rows.push({ title: label.title, wouldApply: label.wouldApply, myScore: label.myScore, finalScore: score.finalScore, llmScore: score.llmScore });
    } catch (err) {
      if (err instanceof ModelUnavailableError) throw err;
      log.warn({ jobId: label.jobId, err: err instanceof Error ? err.message : String(err) }, "could not score; left out");
    }
    log.info({ done: i + 1, of: labels.length, ms: Math.round(performance.now() - started) }, "eval progress");
  }

  console.table(
    rows.map((row) => ({
      title: row.title.slice(0, 48),
      me: row.myScore,
      kira: row.finalScore,
      llm: row.llmScore,
      apply: row.wouldApply ? "yes" : "no",
      kira_shortlists: row.finalScore !== null && row.finalScore >= SCORING_CONFIG.shortlistThreshold ? "yes" : "no",
    })),
  );
  const metrics = evalMetrics(rows, SCORING_CONFIG.shortlistThreshold);
  console.table([metrics]);
  console.log(
    `\nFor PROGRESS.md: eval ${new Date().toISOString().slice(0, 10)} · ${PROMPT_VERSION} · mix ${SCORING_CONFIG.mix.similarity}/${SCORING_CONFIG.mix.llm} · threshold ${SCORING_CONFIG.shortlistThreshold} · ` +
      `n=${metrics.jobs} · precision ${metrics.precision} · recall ${metrics.recall} · spearman ${metrics.spearman} · MAE ${metrics.meanAbsError}`,
  );
} catch (err) {
  log.fatal({ err }, err instanceof ModelUnavailableError ? "Ollama is not running: start it and try again" : "eval failed");
  process.exitCode = 1;
} finally {
  await db.end();
}
