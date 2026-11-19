import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { pino } from "pino";
import { createPool } from "../db/client.ts";
import { loadEnv } from "../env.ts";
import { readLabels, writeLabels } from "./labels.ts";

// `npm run eval:label`: shows jobs one at a time and records my judgement in
// evals/labeled.json. A useful set mixes jobs Kira likes, near misses and
// clear mismatches, so the scores can be checked across the whole range.
const TARGET = Number(process.argv.find((a) => a.startsWith("--target="))?.split("=")[1] ?? 50);
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL });
const db = createPool(env.DATABASE_URL);
const rl = createInterface({ input: stdin, output: stdout });

const CANDIDATES = `
  WITH current AS (
    SELECT j.id, j.company_id, j.title, j.location, j.years_min, m.similarity,
           (m.hard_filter_result->>'passed')::boolean AS passed,
           jsonb_array_length(m.hard_filter_result->'failed') AS failed_rules,
           (SELECT string_agg(f->>'rule', ', ') FROM jsonb_array_elements(m.hard_filter_result->'failed') f) AS failed
      FROM jobs j JOIN matches m ON m.job_id = j.id AND m.is_current
     WHERE j.closed_at IS NULL AND j.duplicate_of IS NULL AND m.similarity IS NOT NULL AND NOT (j.id = ANY($1::text[]))
  ),
  picked AS (
    (SELECT *, 1 AS bucket FROM current WHERE passed)
    UNION ALL (SELECT *, 2 FROM current WHERE failed_rules = 1 ORDER BY similarity DESC LIMIT 20)
    UNION ALL (SELECT *, 3 FROM current WHERE NOT passed AND failed_rules > 1
                  AND lower(title) ~ 'engineer|developer|sde|full.?stack|backend|frontend' ORDER BY similarity DESC LIMIT 15)
    UNION ALL (SELECT *, 4 FROM current WHERE failed_rules > 1 ORDER BY random() LIMIT 10)
  )
  SELECT DISTINCT ON (id) * FROM picked ORDER BY id, bucket`;

try {
  const labels = await readLabels();
  const { rows } = await db.query(CANDIDATES, [labels.map((l) => l.jobId)]);
  const queue = rows.sort((a, b) => a.bucket - b.bucket || b.similarity - a.similarity).slice(0, Math.max(0, TARGET - labels.length));
  console.log(`\n${labels.length} labelled so far; ${queue.length} to go. Answers are saved after every job. q quits.\n`);

  for (const [i, job] of queue.entries()) {
    const text = await db.query<{ content: string }>(
      "SELECT content FROM job_chunks WHERE job_id = $1 AND section IN ('requirements', 'responsibilities') ORDER BY section DESC, ordinal",
      [job.id],
    );
    console.log(`\n──────── ${i + 1}/${queue.length} ────────`);
    console.log(`${job.title}\n${job.company_id} · ${job.location ?? "location not stated"} · asks ${job.years_min ?? "?"} yrs`);
    console.log(`Kira's filters: ${job.passed ? "passed" : `failed (${job.failed})`} · similarity ${Number(job.similarity).toFixed(3)}\n`);
    console.log(text.rows.map((r) => r.content).join("\n\n").slice(0, 1400) || "(no requirements text)");

    const answer = (await rl.question("\nWould you apply? [y]es / [n]o / [s]kip / [q]uit: ")).trim().toLowerCase();
    if (answer === "q") break;
    if (answer !== "y" && answer !== "n") continue;
    let score = NaN;
    while (!(Number.isInteger(score) && score >= 0 && score <= 100)) score = Number((await rl.question("Your fit score 0–100: ")).trim());

    labels.push({ jobId: job.id, company: job.company_id, title: job.title, wouldApply: answer === "y", myScore: score, labeledAt: new Date().toISOString() });
    await writeLabels(labels);
  }
  console.log(`\nSaved ${labels.length} labels to evals/labeled.json. Run \`npm run eval\` to compare Kira's scores with yours.`);
} catch (err) {
  log.fatal({ err }, "labelling failed");
  process.exitCode = 1;
} finally {
  rl.close();
  await db.end();
}
