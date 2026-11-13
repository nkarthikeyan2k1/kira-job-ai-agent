import { pino } from "pino";
import { PATHS } from "../../config/paths.ts";
import { createPool } from "../db/client.ts";
import { loadEnv } from "../env.ts";
import { importResume } from "./import.ts";

// `npm run resume:import`: stores the master resume and prints how it was split,
// so the sections can be checked by eye.
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL });
const db = createPool(env.DATABASE_URL);

try {
  const result = await importResume(db, { tex: PATHS.resumeTex, pdf: PATHS.resumePdf });
  for (const chunk of result.chunks) {
    console.log(`\n── ${chunk.section} #${chunk.ordinal} (${chunk.content.length} chars) ──\n${chunk.content}`);
  }
  console.log("");
  log.info({ versionId: result.versionId, outcome: result.outcome, chunks: result.chunks.length, source: result.source }, "resume import done");
} catch (err) {
  log.fatal({ err }, "resume import failed");
  process.exitCode = 1;
} finally {
  await db.end();
}
