import { pino } from "pino";
import { HARD_FILTER_CONFIG } from "../../config/scoring.ts";
import { createPool } from "../db/client.ts";
import { listUnscoredJobIds } from "../db/jobs-repo.ts";
import { loadEnv } from "../env.ts";
import { runDedupeFilterStage } from "./dedupe-filter-stage.ts";

// `npm run filter:report`: how the hard filters split the stored jobs, for
// tuning the profile. With `-- --refilter` it first re-runs the filters on
// every job that has no score yet (use it after changing the profile).
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL });
const db = createPool(env.DATABASE_URL);

const CURRENT = "FROM matches m JOIN jobs j ON j.id = m.job_id WHERE m.is_current AND j.closed_at IS NULL";
const table = async (title: string, sql: string) => {
  const { rows } = await db.query(sql);
  console.log(`\n${title}`);
  if (rows.length === 0) console.log("  (none)");
  else console.table(rows);
};

try {
  if (process.argv.includes("--refilter")) {
    await runDedupeFilterStage({ db, log, config: HARD_FILTER_CONFIG }, await listUnscoredJobIds(db));
  }

  await table(
    "Jobs",
    `SELECT (SELECT count(*)::int FROM jobs WHERE closed_at IS NULL) AS open,
            (SELECT count(*)::int FROM jobs WHERE closed_at IS NULL AND duplicate_of IS NOT NULL) AS duplicates,
            count(*) FILTER (WHERE (m.hard_filter_result->>'passed')::boolean)::int AS passed,
            count(*) FILTER (WHERE NOT (m.hard_filter_result->>'passed')::boolean)::int AS failed
       ${CURRENT}`,
  );
  await table(
    "Failures by rule (a job can fail several)",
    `SELECT f->>'rule' AS rule, count(*)::int AS jobs ${CURRENT.replace("FROM matches m", "FROM matches m CROSS JOIN LATERAL jsonb_array_elements(m.hard_filter_result->'failed') f")}
      GROUP BY 1 ORDER BY 2 DESC`,
  );
  await table(
    "Jobs failing exactly one rule (the ones a small profile change would let through)",
    `SELECT m.hard_filter_result->'failed'->0->>'rule' AS only_rule, count(*)::int AS jobs ${CURRENT}
        AND jsonb_array_length(m.hard_filter_result->'failed') = 1 GROUP BY 1 ORDER BY 2 DESC`,
  );
  await table(
    "Rules that could not be checked",
    `SELECT u AS rule, count(*)::int AS jobs ${CURRENT.replace("FROM matches m", "FROM matches m CROSS JOIN LATERAL jsonb_array_elements_text(m.hard_filter_result->'unknown') u")}
      GROUP BY 1 ORDER BY 2 DESC`,
  );
  await table(
    "Passed",
    `SELECT j.company_id AS company, left(j.title, 58) AS title, left(j.location, 34) AS location, j.seniority, j.years_min AS years ${CURRENT}
        AND (m.hard_filter_result->>'passed')::boolean ORDER BY j.company_id, j.title LIMIT 60`,
  );
} catch (err) {
  log.fatal({ err }, "filter report failed");
  process.exitCode = 1;
} finally {
  await db.end();
}
