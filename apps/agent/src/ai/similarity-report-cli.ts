import { pino } from "pino";
import { EMBEDDING } from "../../config/llm-routing.ts";
import { CHUNK_CONFIG, SIMILARITY_CONFIG } from "../../config/scoring.ts";
import { createPool } from "../db/client.ts";
import { insertLlmCall } from "../db/llm-calls-repo.ts";
import { loadEnv } from "../env.ts";
import { runEmbedStage } from "../pipeline/embed-stage.ts";
import { createLlmClient } from "./llm-client.ts";

// `npm run similarity:report`: how the jobs rank against the resume, for a
// sanity check of retrieval. `-- --embed` first runs stage [3] (no fetch).
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL });
const db = createPool(env.DATABASE_URL);

const CURRENT = `FROM matches m JOIN jobs j ON j.id = m.job_id
  WHERE m.is_current AND j.closed_at IS NULL AND m.similarity IS NOT NULL`;
// The resume chunk that best matches the job's first basis chunk, as "section: first line".
const BEST_RESUME = `(SELECT rc.section || ': ' || left(split_part(rc.content, E'\\n', 1), 48)
    FROM job_chunks jc
    JOIN resume_chunks rc ON rc.embedding IS NOT NULL
    JOIN resume_versions rv ON rv.id = rc.resume_version_id AND rv.is_active
   WHERE jc.job_id = j.id AND jc.embedding IS NOT NULL
   ORDER BY (jc.section <> 'requirements'), jc.ordinal, rc.embedding <=> jc.embedding
   LIMIT 1) AS best_resume_chunk`;

const table = async (title: string, sql: string) => {
  const { rows } = await db.query(sql);
  console.log(`\n${title}`);
  if (rows.length === 0) console.log("  (none)");
  else console.table(rows);
};

try {
  if (process.argv.includes("--embed")) {
    const llm = createLlmClient({ ollamaUrl: env.OLLAMA_URL, recordCall: (call) => insertLlmCall(db, call) });
    await runEmbedStage({ db, log, llm, settings: { tag: EMBEDDING.tag, chunk: CHUNK_CONFIG, embedSections: SIMILARITY_CONFIG.embedSections } });
  }

  await table(
    "Chunking",
    `SELECT (SELECT count(*)::int FROM jobs WHERE embedding_model = '${EMBEDDING.tag}') AS jobs_embedded,
            (SELECT count(*)::int FROM job_chunks) AS chunks,
            (SELECT count(*)::int FROM job_chunks WHERE embedding IS NOT NULL) AS chunks_with_vector,
            (SELECT round(avg(n), 1) FROM (SELECT count(*) AS n FROM job_chunks GROUP BY job_id) s) AS chunks_per_job,
            (SELECT max(length(content)) FROM job_chunks) AS longest_chunk,
            (SELECT count(*)::int FROM resume_chunks rc JOIN resume_versions rv ON rv.id = rc.resume_version_id AND rv.is_active
              WHERE rc.embedding IS NOT NULL) AS resume_chunks_with_vector`,
  );
  await table(
    "Similarity distribution (raw cosine)",
    `SELECT count(*)::int AS jobs, round(min(m.similarity)::numeric, 3) AS min,
            round((percentile_cont(0.5) WITHIN GROUP (ORDER BY m.similarity))::numeric, 3) AS median,
            round((percentile_cont(0.9) WITHIN GROUP (ORDER BY m.similarity))::numeric, 3) AS p90,
            round(max(m.similarity)::numeric, 3) AS max ${CURRENT}`,
  );
  await table(
    "Top 20 overall",
    `SELECT left(j.company_id, 13) AS company, left(j.title, 46) AS title, left(j.location, 22) AS location,
            round(m.similarity::numeric, 3) AS sim, (m.hard_filter_result->>'passed')::boolean AS passed, ${BEST_RESUME}
       ${CURRENT} ORDER BY m.similarity DESC LIMIT 20`,
  );
  await table(
    "Jobs that passed the hard filters, ranked",
    `SELECT left(j.company_id, 13) AS company, left(j.title, 52) AS title, round(m.similarity::numeric, 3) AS sim,
            round(m.similarity_norm::numeric, 2) AS norm, ${BEST_RESUME}
       ${CURRENT} AND (m.hard_filter_result->>'passed')::boolean ORDER BY m.similarity DESC`,
  );
  await table(
    "Most similar jobs the hard filters rejected (for tuning the profile)",
    `SELECT left(j.company_id, 13) AS company, left(j.title, 44) AS title, left(j.location, 20) AS location,
            round(m.similarity::numeric, 3) AS sim,
            (SELECT string_agg(f->>'rule', ', ') FROM jsonb_array_elements(m.hard_filter_result->'failed') f) AS failed
       ${CURRENT} AND NOT (m.hard_filter_result->>'passed')::boolean ORDER BY m.similarity DESC LIMIT 15`,
  );
  console.log(`\nTop ${SIMILARITY_CONFIG.topN} passing jobs go on to the LLM step (stage [4]).`);
} catch (err) {
  log.fatal({ err }, "similarity report failed");
  process.exitCode = 1;
} finally {
  await db.end();
}
