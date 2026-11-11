import { pino } from "pino";
import { createPool } from "./db/client.ts";
import { loadEnv } from "./env.ts";
import { runPipeline } from "./pipeline/run.ts";
import { PIPELINE_STAGES } from "./pipeline/stages.ts";

// Runs the full pipeline once (`npm run run:agent`). The scheduler will call
// the same runPipeline().
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL });
const db = createPool(env.DATABASE_URL);

try {
  await runPipeline(PIPELINE_STAGES, { log, db });
} catch (err) {
  log.fatal({ err }, "pipeline failed");
  process.exitCode = 1;
} finally {
  await db.end();
}
