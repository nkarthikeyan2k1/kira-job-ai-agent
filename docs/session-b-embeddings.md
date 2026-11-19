# Session B spec: stage [3] chunking, embeddings, similarity

Status: **design approved 2026-11-14, not built.** Written so an Opus session can implement it
without redesigning. Read `CLAUDE.md` ("Two modes", "Scoring design", "Ollama gotchas",
"Conventions") first. If this spec and the code disagree, stop and ask.

## Facts measured on this machine (don't re-derive)

- Ollama 0.34.4, `nomic-embed-text`: 768 dimensions, vectors come back normalized (length 1).
- `POST {OLLAMA_URL}/api/embed` with `{ model, input: string[] }` → `{ embeddings: number[][], prompt_eval_count }`.
- Hard input limit: 2,048 tokens (about 3.07 characters per token, so about 6,000 characters).
  By default longer input is **cut silently**. With `truncate: false` Ollama answers
  `400 {"error":"the input length exceeds the context length"}`. Always send `truncate: false`.
- Speed: 32 inputs of 1,568 characters in 1.0 s. All 1,089 stored jobs: about 2–3 minutes.
- Prefixes (required by the model): `search_document: ` for every JD-side text,
  `search_query: ` for every resume-side text. Keep this consistent in later sessions.
- Sanity check: a Node.js requirement scored 0.66 against a matching resume bullet and 0.45
  against an unrelated one.
- 1,058 of 1,089 descriptions (97%) contain a requirements-like heading. Common headings:
  Stripe "Minimum requirements", "Preferred qualifications", "Who you are", "What you'll do",
  "Responsibilities", "About Stripe", "About the team"; Paytm "Key responsibilities",
  "Expectations/ Requirements", "About us", "Why join us", "Compensation"; BMW "Must have
  technical skill", "Good to have technical skills", "What should you bring along", "What awaits
  you/ Job profile"; CRED "what we're looking for", "you should apply if you have",
  "what will you do", "what you'll own".
- Descriptions are plain text already: headings are short lines, bullets start with `- `,
  blank lines separate paragraphs (see `lib/html-to-text.ts`).

## Decisions (approved; they differ from older text in CLAUDE.md, update it at the end)

1. Embed **every open, non-duplicate job**, not only those that passed the hard filters. It is
   local, free and fast. The LLM step (Session C) still takes only passing or unenforced jobs.
2. `similarity_norm` is min-max over **all** embedded open jobs, not per run.
3. `jobs.embedding` (one vector per job) stays NULL. Similarity is computed from chunk vectors.
   `jobs.embedding_model` alone marks a job as embedded.
4. Resume chunks stay as imported (8 coarse chunks). No re-chunking.
5. Only `requirements` and `responsibilities` chunks (and `other` when a job has neither) get
   vectors. `about` and `benefits` chunks are stored as text with `embedding` NULL.
6. No migration is needed.

## Data flow

```
stage [3] "embed"  (apps/agent/src/pipeline/embed-stage.ts: only the loop)
  embedResume(db, llm)                 vectors for the active resume's chunks, if missing or stale
  for each job in listJobsToEmbed():
    embedJob(db, llm, jobId)           chunk → embed → replace job_chunks → set jobs.embedding_model
    similarityForJob(db, jobId)        compute + write matches.similarity on the current match row
  normalizeSimilarities(db)            set-based: matches.similarity_norm for every current match
```

Ollama unreachable (after one retry) → throw `ModelUnavailableError`; the stage catches it, logs
`warn` "embedding deferred to next run" and returns normally. Never fail the pipeline for it,
never use a paid tier.

## Modules

```
apps/agent/config/llm-routing.ts      task → { tier, model, options }; embedding tag; batch size; timeouts
apps/agent/config/scoring.ts          add: chunk limits, similarity settings, topN (see below)
apps/agent/src/ai/ollama.ts           thin HTTP client for /api/embed (injectable fetch + now)
apps/agent/src/ai/llm-client.ts       createLlmClient({ db, ollamaUrl, routing, fetch? }): embed(task, texts)
apps/agent/src/ai/chunk.ts            pure: chunkJobDescription(text, config) → JobChunkDraft[]
apps/agent/src/ai/embed.ts            embedJob, embedResume
apps/agent/src/ai/retrieve.ts         similarityForJob, retrieveResumeChunks, normalizeSimilarities
apps/agent/src/ai/similarity-report-cli.ts
apps/agent/src/db/chunks-repo.ts      SQL for job_chunks / resume_chunks vectors
apps/agent/src/db/llm-calls-repo.ts   insertLlmCall
apps/agent/src/pipeline/embed-stage.ts
```

`StageContext` gains what the stage needs (the Ollama URL from `env.ts`; never read
`process.env` elsewhere). Replace `stub("embed")` in `pipeline/stages.ts`.

### Config

```ts
// config/llm-routing.ts
export const LLM_ROUTING = {
  "embed.job_chunk":    { tier: "local", model: "nomic-embed-text", prefix: "search_document: " },
  "embed.resume_chunk": { tier: "local", model: "nomic-embed-text", prefix: "search_query: " },
} as const;
export const EMBEDDING = {
  // Changing the model, the prefixes or the chunker must change this tag: everything is re-embedded.
  tag: "nomic-embed-text/c1",
  dimensions: 768,
  numCtx: 2048,
  keepAlive: "10m",
  timeoutMs: 60_000,
  retries: 1,
} as const;

// config/scoring.ts (new block)
export const CHUNK_CONFIG = { maxChars: 2400, minChars: 60, headingMaxChars: 60, headingMaxWords: 8 };
export const SIMILARITY_CONFIG = { embedSections: ["requirements", "responsibilities"], topN: 30 };
```

### Signatures

```ts
// ai/chunk.ts (pure)
interface JobChunkDraft { section: JobChunkSection; ordinal: number; content: string }
function chunkJobDescription(description: string, config: typeof CHUNK_CONFIG): JobChunkDraft[]

// ai/llm-client.ts
interface LlmClient { embed(task: keyof typeof LLM_ROUTING, texts: string[]): Promise<number[][]> }
class ModelUnavailableError extends Error {}   // connection refused / timeout after the retry
class ModelInputError extends Error {}         // 400 (e.g. input too long): not retried

// ai/embed.ts
function embedResume(db, llm): Promise<{ embedded: number }>
function embedJob(db, llm, jobId): Promise<{ chunks: number; embedded: number }>

// ai/retrieve.ts
interface ChunkPair { jobChunkId: number; jobSection: JobChunkSection; resumeChunkId: number; resumeSection: ResumeSection; cosine: number }
function similarityForJob(db, jobId): Promise<{ similarity: number; basis: JobChunkSection; pairs: ChunkPair[] } | null>
function retrieveResumeChunks(db, jobChunkId, k): Promise<{ id: number; section: ResumeSection; content: string; cosine: number }[]>
function normalizeSimilarities(db): Promise<{ jobs: number; min: number; max: number }>
```

## Chunking rules (`ai/chunk.ts`)

1. Split the text into lines. A **heading** is a non-bullet line with at most `headingMaxChars`
   characters and `headingMaxWords` words that does not end in `.`, `!` or `?` (a trailing `:` is
   fine).
2. Classify a heading by keyword (case-insensitive), first match wins:
   - `requirements`: require, qualif, who you are, what you'll need, what we're looking for,
     you have, you'll bring, bring along, must have, good to have, nice to have, preferred,
     skill, experience, about you, apply if, ideal candidate, eligib, expectations, education
   - `responsibilities`: responsib, what you'll do, what you will do, what will you do, the role,
     your role, about the role, role overview, job profile, what awaits, what you'll own, duties,
     day to day, key deliverables
   - `about`: about us, about (the) team, about the company/unit, who we are, what is, our mission,
     why join, unit overview, about <company name>
   - `benefits`: benefit, perks, compensation, what we offer, pay and
   Check `responsibilities` patterns such as "about the role" before the generic `about`.
3. A heading that matches nothing **inherits** the current section (sub-headings are far more
   common than unknown top-level sections). Text before the first classified heading is `other`.
4. A chunk's content starts with its heading line, so "Preferred qualifications" stays visible
   to the scoring step.
5. A section longer than `maxChars` is split at blank lines or bullet boundaries, greedily
   packed; every piece repeats the heading. A single bullet longer than `maxChars` is split at
   sentence ends, then hard-cut as a last resort (log a warning: "if something must be cut, log it").
6. A piece shorter than `minChars` is merged into the previous chunk of the same section; if
   there is none, it is kept.
7. `ordinal` counts per section from 0 (unique key is `(job_id, section, ordinal)`).
8. Empty or whitespace-only description → `[]`.

## Embedding rules (`ai/embed.ts`)

- A job needs embedding when `jobs.embedding_model IS DISTINCT FROM EMBEDDING.tag`
  (`upsertJobs` already clears `embedding_model` when a description changes).
  `listJobsToEmbed`: open, `duplicate_of IS NULL`, needs embedding; oldest first.
- `embedJob`: load the job → chunk → choose which chunks get vectors (`embedSections`; if the job
  has none of those, embed its `other` chunks) → one `llm.embed("embed.job_chunk", texts)` call
  → in **one transaction**: delete the job's `job_chunks`, insert all chunks (vector or NULL,
  `embedding_model = tag` where a vector exists), set `jobs.embedding_model = tag`.
  A `ModelInputError` for one job: log, skip that job, continue with the next.
- Vectors are written as pgvector literals: `'[0.1,0.2,…]'::vector`. Validate length = 768 and
  that every number is finite before writing.
- `embedResume`: chunks of the active version where `embedding_model IS DISTINCT FROM tag`,
  embedded with `"embed.resume_chunk"`. Skip the contact chunk (`section = 'other'`,
  `ordinal = 0`): it is PII and carries no skills.
- The client adds the task's prefix; callers pass plain text.
- Every HTTP call writes one `llm_calls` row: task, tier `local`, model, `tokens_in`
  (`prompt_eval_count`), `tokens_out` 0, `cost_usd` 0, `latency_ms`, `ok`, `error`.

## Similarity (`ai/retrieve.ts`)

Concept for the code comment: cosine similarity is the cosine of the angle between two vectors;
pgvector's `<=>` returns cosine **distance**, so similarity = `1 - (a <=> b)`.

- Basis section: `requirements` if the job has embedded chunks of it, else `responsibilities`,
  else `other`.
- For each basis chunk: its best cosine over the active resume's embedded chunks, and which
  resume chunk that was.
- Job similarity = average of those best cosines, weighted by `length(content)`, clamped to 0–1.
- Write it to `matches.similarity` on the job's **current** match row, only when that row has
  no `final_score` (a scored row is history; never edit it). No current match row → return the
  value, write nothing.
- `normalizeSimilarities`: over current matches of open jobs with a similarity,
  `similarity_norm = (s - min) / (max - min)`; when `max = min`, set 1 for all. One UPDATE.
- `retrieveResumeChunks(jobChunkId, k)`: `ORDER BY r.embedding <=> j.embedding LIMIT k` over the
  active resume. Session C uses it to give the LLM the right resume evidence.

Sketch of the per-job query:

```sql
SELECT jc.id AS job_chunk_id, jc.section, length(jc.content) AS weight,
       best.id AS resume_chunk_id, best.section AS resume_section, 1 - best.distance AS cosine
  FROM job_chunks jc
  CROSS JOIN LATERAL (
    SELECT rc.id, rc.section, rc.embedding <=> jc.embedding AS distance
      FROM resume_chunks rc
      JOIN resume_versions rv ON rv.id = rc.resume_version_id AND rv.is_active
     WHERE rc.embedding IS NOT NULL
     ORDER BY rc.embedding <=> jc.embedding
     LIMIT 1
  ) best
 WHERE jc.job_id = $1 AND jc.embedding IS NOT NULL AND jc.section = $2;
```

## Commands

- `npm run similarity:report` (root + agent scripts, same pattern as `filter:report`).
  `-- --embed` runs stage [3] first (no fetch). Prints:
  1. chunking stats: jobs embedded, chunks per job, basis section counts (how many fell back),
     longest chunk, jobs skipped for input errors
  2. similarity distribution: min, median, p90, max
  3. top 20 jobs overall: company, title, location, similarity, passed?, best resume chunk
     (section + first line)
  4. passing jobs ranked
  5. top 15 jobs the hard filters rejected, with the failed rules (for tuning the profile)

## Tests

Unit (no network, no DB):
- `chunk.test.ts`: one description per real style (Stripe, Paytm, BMW, CRED; write them as
  short fixtures in the test), sub-heading inheritance, text before the first heading is `other`,
  long section split with repeated heading and every piece ≤ `maxChars`, tiny fragment merged,
  no headings at all → one or more `other` chunks, empty input → `[]`.
- `llm-client.test.ts` with a fake `fetch`: prefix added, `truncate: false` + `num_ctx` +
  `keep_alive` sent, one retry on network error or 5xx then success, `ModelUnavailableError`
  after the retry fails, 400 → `ModelInputError` without retry, wrong vector length rejected,
  an `llm_calls` row for success and for failure (inject the logger function).
- normalising maths as a pure helper if any is extracted.

Integration (`jobagent_test`, pattern of `dedupe-filter-stage.integration.test.ts`) with a
**fake embedder**: a deterministic function text → 768-dim unit vector (e.g. hash each word into
a bucket), so related texts are close. No Ollama.
- `embedJob` stores chunks; only the right sections have vectors; `embedding_model` set.
- Running it twice does nothing the second time; changing the description (via `upsertJobs`)
  makes the job eligible again and replaces its chunks.
- `similarityForJob` picks the resume chunk that shares the words, writes `matches.similarity`,
  and does not touch a scored match.
- Fallback basis when a job has no requirements section.
- Stage: `ModelUnavailableError` → stage returns, nothing written, no throw.
- A manual job is embedded and gets a similarity like any other.
- `normalizeSimilarities`: min → 0, max → 1, single job → 1.

## Verify on real data (after the tests pass)

1. `npm run similarity:report -- --embed` with Ollama running: about 2–3 minutes.
2. Read the top 20 and the per-job best resume chunk: do they make sense for a Node.js / React
   fintech developer? Expect the Paytm and Stripe backend/full-stack roles near the top.
3. Run it again: nothing is re-embedded.
4. `SELECT count(*) FROM llm_calls` shows the calls.

## Done

`npm run typecheck`, `npm test`, `npm run lint -w apps/web` pass; `npm run run:agent` runs
stage [3]; CLAUDE.md updated (decisions above, folder structure, commands, status; also remove
the stale line "seniority and years_min stay null until JD parsing exists"); `PROGRESS.md`
appended. Do not commit.
