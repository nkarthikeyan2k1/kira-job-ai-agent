import { pino } from "pino";
import { SCORING_CONFIG, SIMILARITY_CONFIG } from "../../config/scoring.ts";
import { createLlmClient } from "../ai/llm-client.ts";
import { createPool } from "../db/client.ts";
import { insertLlmCall } from "../db/llm-calls-repo.ts";
import { loadEnv } from "../env.ts";
import { runScoreStage } from "../pipeline/score-stage.ts";

// `npm run score:report`: the scored jobs, best first, with each one's
// requirement breakdown. `-- --score` runs stages [4] + [5] first (needs Ollama).
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL });
const db = createPool(env.DATABASE_URL);

try {
  if (process.argv.includes("--score")) {
    const llm = createLlmClient({ ollamaUrl: env.OLLAMA_URL, recordCall: (call) => insertLlmCall(db, call) });
    await runScoreStage({ db, log, llm, config: SCORING_CONFIG, topN: SIMILARITY_CONFIG.topN });
  }

  const { rows } = await db.query(
    `SELECT j.company_id, j.title, j.location, m.final_score, m.llm_score, round(m.similarity_norm::numeric, 2) AS sim_norm,
            m.reason, m.breakdown, a.status AS application
       FROM matches m JOIN jobs j ON j.id = m.job_id LEFT JOIN applications a ON a.job_id = j.id
      WHERE m.is_current AND m.final_score IS NOT NULL
      ORDER BY m.final_score DESC`,
  );
  if (rows.length === 0) console.log("\nNo scored jobs yet. Run `npm run score:report -- --score` with Ollama running.");
  for (const row of rows) {
    console.log(`\n${row.final_score} · ${row.title} · ${row.company_id} · ${row.location ?? "?"}`);
    console.log(`  llm ${row.llm_score} · similarity ${row.sim_norm} · ${row.application ? `application: ${row.application}` : "not shortlisted"}`);
    console.log(`  ${row.reason}`);
    for (const item of row.breakdown) {
      const evidence = item.evidence ? ` ← "${String(item.evidence).slice(0, 70)}${item.evidence.length > 70 ? "…" : ""}"` : "";
      console.log(`    [${item.weight.padEnd(4)} ${item.status.padEnd(7)}] ${item.requirement.slice(0, 80)}${evidence}`);
    }
  }
  console.log(`\nThreshold ${SCORING_CONFIG.shortlistThreshold}; mix similarity ${SCORING_CONFIG.mix.similarity} / llm ${SCORING_CONFIG.mix.llm}.`);
} catch (err) {
  log.fatal({ err }, "score report failed");
  process.exitCode = 1;
} finally {
  await db.end();
}
