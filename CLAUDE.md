# Kira — AI job-search platform

## Who I am

Full-stack engineer (~5 years): Node.js, TypeScript, React/Next.js, PostgreSQL, microservices, Redis, Docker, real-time trading systems. Kira is a personal project: it runs my own job search and is a portfolio piece. Write production-quality code I could walk through in an interview.

I'm newer to applied AI. When you write AI code (embeddings, cosine similarity, chunking, RAG, tokens, prompt design), explain the concept briefly in a comment or in your reply.

## What Kira does

An AI job-search assistant: finds relevant jobs, scores how well each matches my profile, tailors my resume for good matches, and tracks every application to an outcome. **Kira prepares; I decide and submit.**

1. **Profile**: target roles, skills, experience level, preferred locations, salary range, visa/work-auth, deal-breakers, and my master resume.
2. **Company sources**: target companies (large MNCs, strong product companies), each with its careers URL and ATS type. Adding a company is a config change, not new code.
3. **Job fetching** (daily or every 2 days): public ATS APIs first (Greenhouse, Lever, Ashby, Workday). Scrape only public pages with no API, under the rules in _Data sources_. Archive the full JD text at first fetch; postings disappear and I'll need them at interview time.
4. **Normalize → dedupe → hard filters** before any AI work (filters are free; LLM calls are not).
5. **Embedding**: master resume and JDs are chunked by section, embedded with `nomic-embed-text`, stored in pgvector.
6. **RAG matching + scoring** (0–100): retrieve relevant resume evidence per job requirement; score skills, seniority, location, salary, domain; store the score, the per-requirement breakdown and a short "why it matches / what's missing".
7. **Liveness check**: confirm the posting is still open before shortlisting, tailoring or emailing it.
8. **Shortlist**: 70+ only, sorted by score; email digest and/or exported file (Markdown/CSV).
9. **Resume tailoring**: LaTeX I can open in Overleaf. **Never invent experience, skills, titles or numbers**: only reorder, reword and emphasise what's in the master resume. Enforced in code (see _No-invention guard_).
10. **Apply assist**: pre-fill forms with my details and tailored answers. **Never clicks Submit. No mass auto-apply.**
11. **Tracking + follow-up**: status history, dates, notes, follow-up reminders.

## Architecture

Monorepo (npm workspaces). Postgres + pgvector is the bridge between apps.

| App / package     | Does                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/agent`      | Fastify API (port 4000) + worker: fetch, embed, score, tailor, email, scheduler. All AI work.                                       |
| `apps/web`        | Next.js dashboard (port 3000): shortlist, tracker, profile. Reads Postgres; writes only tracker/profile CRUD through the agent API. |
| `packages/shared` | `Job` / `Match` / `Application` types, Zod schemas, SQL schema + migrations. Defined once, imported everywhere.                     |

- No agent logic in Next.js: Ollama calls can take minutes and the scheduler is long-running.
- Build `apps/agent` end-to-end first. Add `apps/web` only after the agent produces real matches.

```
scheduler (daily / every 2 days, with catch-up after the Mac wakes)
  → [1] fetchers (one adapter per ATS)             → raw JSON kept 7 days
  → [2] normalize → dedupe → hard filters          (no LLM)
  → [3] embed new JDs → pgvector top-N vs resume   (local, free)
  → [4] per-requirement extraction + evidence      (local LLM)
  → [5] weighted score in code, threshold 70       (deterministic)
  → [6] liveness check on the shortlist            (no LLM)
  → [7] final explanation, tailoring, answers      (paid API, shortlist only)
  → [8] digest email + export; tracker rows created
```

### Folder structure

```
apps/agent/src/
  fetchers/      # one file per ATS (greenhouse, lever, peoplestrong), all implement Fetcher; http.ts; __fixtures__/
  lib/           # html-to-text.ts, html-entities.ts
  pipeline/      # [1] fetch-stage.ts, normalize.ts, url.ts, raw-store.ts
                 # [2] dedupe-filter-stage.ts (loop), dedupe.ts + dedupe-job.ts, filters.ts (pure rules) + filter-job.ts,
                 #     job-attributes.ts (seniority, years), places.ts, filter-report-cli.ts
  profile/       # import.ts: data/profile.json → profile row
  resume/        # latex-to-text.ts, pdf-text.ts, sections.ts, import.ts: master resume → resume_versions + chunks
  ai/            # [3] chunk.ts (pure), embed.ts (embedJob, embedResume), retrieve.ts (similarityForJob, retrieveResumeChunks),
                 #     llm-client.ts (embed + generateJson: routing, retries, llm_calls), ollama.ts, vector.ts, similarity-report-cli.ts,
                 #     prompts/extract-requirements.ts (prompt + PROMPT_VERSION + Zod/JSON schema)
  scoring/       # [4] extract.ts (model call), verify.ts (pure: quote + weight checks); [5] score.ts (pure maths),
                 #     score-job.ts (computeJobScore, scoreJob), eval-metrics.ts, labels.ts, eval/eval-label/score-report CLIs
  tailoring/     # latex.ts, fact-inventory.ts, guard.ts
  apply/         # playwright prefill (later)
  tracker/       # status transitions, follow-up cadence
  db/            # client.ts, migrate, *-repo.ts (all SQL lives here)
  config/        # companies.ts: loads + validates config/companies.json
  output/        # report.ts, email.ts
  scheduler.ts, server.ts, index.ts (runs the pipeline once)
apps/agent/config/
  companies.json      # target companies
  fetch.ts            # user agent, timeouts, retry, rate limit, raw retention
  llm-routing.ts      # task → model/tier/prefix (single source of truth); EMBEDDING tag + settings
  scoring.ts          # hard-filter mechanics; CHUNK_CONFIG, SIMILARITY_CONFIG (embedded sections, topN); SCORING_CONFIG (mix, weights, threshold)
  paths.ts            # where the personal files live
  profile.example.json  # format of data/profile.json
  follow-ups.ts       # cadence
apps/agent/evals/labeled.json   # hand-labeled jobs for tuning (committed; written by `npm run eval:label`)
apps/agent/data/                # gitignored: resume.pdf, raw/, output/
```

## Data model (`packages/shared`)

The schema is `packages/shared/src/db/migrations/0001_init.sql`; read it for columns. Each table has a Zod schema + type in `packages/shared/src/entities/`; dashboard read models are in `views.ts`. Change the schema only by adding a numbered migration (`NNNN_name.sql`); never edit an applied one (the runner checks checksums) and never run ad-hoc `ALTER`s.

- `companies`: id = slug from `companies.json`; `ats`, `ats_key`, `ats_config` jsonb (per-ATS extras, validated by that ATS's fetcher: Lever `{ region: "eu" }`; Workday host + site later), `tier` 1–3.
- `jobs`: id (`gh:{board}:{id}`, `wd:{tenant}:{id}`); unique `url_normalized` and `(source, company_id, external_id)` (Workday ids repeat across tenants); salary columns only when the source states them; `seniority` and `years_min` are read from the title and text by rules (`job-attributes.ts`); `duplicate_of` / `repost_of` link copies and reposts; `embedding vector(768)` + `embedding_model`.
- `job_chunks`, `resume_versions` (one `is_active`), `resume_chunks`: chunk text + embedding + `embedding_model`. Only `requirements` / `responsibilities` job chunks (or `other` when a job has neither) get vectors; `about` / `benefits` are text only. `jobs.embedding_model` = the `EMBEDDING.tag` a job was chunked with; `jobs.embedding` (one vector per job) is unused.
- `matches`: **append-only history**, one `is_current` row per job. `hard_filter_result` jsonb; score columns are null when a hard filter failed; `final_score` is stored **0–100**; `breakdown` and `adjustments` jsonb explain the score.
- `applications`: created when a job is **shortlisted** (`found`/`scored` are derived, never stored). `application_events` is the append-only status history.
- `llm_calls` (cost + daily budget), `fetch_runs` (`jobs_seen` / `jobs_new` / `jobs_closed`), `profile` (single row: title keywords, target levels, locations, salary floor, `work_auth_countries`, notice period, deal-breakers; loaded from the gitignored `data/profile.json`).

Rules:

- Enum-like columns are `text` + a named `CHECK`; the value lists come from `packages/shared/src/enums.ts`, and an integration test fails if the two drift.
- SQL is snake_case, TypeScript camelCase: read rows with `parseRows(Schema, rows)` (`db/rows.ts`), which renames columns and validates with Zod.
- Entity schemas leave out `embedding`; only the AI code reads or writes vectors.
- `hard_filter_result` is `{ passed, enforced, failed: [{ rule, detail }], unknown: [rule] }`. `unknown` = the posting lacks the data; it never fails a job. `enforced: false` (manual jobs) lets a failed job still be scored.
- Not in the schema yet (later migrations): drafted application answers, scheduler tables.

Statuses: `found → scored → shortlisted → applied → responded → interview → offer | rejected`, plus `skipped` (my decision), `ghosted` (no reply after max follow-ups), `withdrawn`, `closed` (posting gone). `JobStatus` = all 12 (display); `ApplicationStatus` = the 10 stored. Transitions are validated in one place (`tracker/`), not scattered.

## LLM routing (`apps/agent/config/llm-routing.ts`)

Every LLM call goes through `ai/llm-client.ts` with a task name; routing comes from the config, so moving a task between tiers changes one line.

| Task                                                  | Tier  | Notes                                  |
| ----------------------------------------------------- | ----- | -------------------------------------- |
| JD parsing (sections, requirements, years, seniority) | local |                                        |
| keyword extraction + match vs profile                 | local |                                        |
| per-requirement first-pass scoring                    | local | output is evidence, not a final number |
| dedup "same job?" check for near-duplicates           | local | only when fingerprints collide         |
| final match explanation (shortlist only)              | paid  |                                        |
| resume tailoring (LaTeX)                              | paid  | passes through the no-invention guard  |
| application answers                                   | paid  |                                        |

- **Local** (Ollama, MacBook Air M5, 16 GB): `qwen2.5:7b` (fallback `llama3.1:8b`), temperature 0 for scoring. Embeddings: `nomic-embed-text` (768 dims). Larger models won't fit next to dev tools.
- **Paid** (TBD; see _Open decisions_). If Claude: send no `temperature` / `top_p` (rejected on current API versions), use structured outputs validated with Zod, check `stop_reason` (handle `refusal` and `max_tokens`), cache the stable prefix (instructions + master resume) with prompt caching, and use the Batch API (≈50% cheaper) for overnight non-urgent tailoring.
- **Timeouts + fallback**: every local call has a timeout and one retry. If Ollama is down (Mac asleep, low RAM), **defer the job to the next run**; don't silently send high-volume tasks to the paid tier. A task may fall back to paid only if its route says so, and only under the daily budget cap.
- **Budget cap**: daily `PAID_LLM_BUDGET_USD` in `.env`, checked against `llm_calls` before every paid call; over the cap → queue, don't call.

### Ollama gotchas

- Set `num_ctx` explicitly on every call (e.g. 8192). The default is small, and longer input is **truncated silently**.
- `nomic-embed-text` needs task prefixes: `search_document: ` for JD chunks, `search_query: ` for resume chunks/queries. Without them retrieval quality drops.
- Keep one model loaded at a time; `keep_alive` tuned so the 7B model doesn't evict and reload between jobs.

## Scoring design

1. **Hard filters (free, before embedding)**: title keywords (positive/negative), location/remote policy, seniority band, years required vs mine, visa/no-sponsorship statements, salary floor when stated. Failing a hard filter stores `hard_filter_result` and stops; no LLM call. Rules are pure functions in `pipeline/filters.ts`; on-site/hybrid jobs must match one of my cities, remote jobs are judged by `work_auth_countries`. A rule that cannot be checked is `unknown`, never a failure.
2. **Similarity** (built, `ai/retrieve.ts`): for each requirements chunk (else responsibilities, else other), its best cosine against the resume chunks; the job's similarity is the length-weighted average. Every open job is embedded, not only passing ones. Raw values sit in 0.48–0.74, so `similarity_norm` is **min-max over all open jobs** (not per run). Only the top-N passing jobs go to the LLM.
3. **Per-requirement extraction (local LLM, built)**: `qwen2.5:7b` gets the job's requirements chunks (else responsibilities / other) in `<JOB>` and the **whole resume** in `<RESUME>` (`SCORING_CONFIG.resumeContext: "retrieved"` switches to RAG-retrieved chunks), and returns `{ requirement, weight: must|nice, status: met|partial|missing, evidence }` constrained by a JSON schema (temperature 0, seed 1, deterministic). Code then enforces (`scoring/verify.ts`): evidence must be a real resume quote (else dropped); `met` without valid evidence → `partial`; wording like "a plus / preferred / good to have" → `nice`. ~20–50 s per job on the M5.
4. **Score in code, not by the LLM** (built, `scoring/score.ts`): `llm_score` = 100 × Σ weight·value / Σ weight with must = 2, nice = 1, met = 1, partial = 0.5, missing = 0; `final = 100 × (0.4 · similarity_norm + 0.6 · llm_score/100)` (one part carries all the weight if the other is missing). No dimension adjustments yet (hard filters cover location, level, salary). `final ≥ 70` → `applications` row `shortlisted` + event. Tune on the eval set.
5. **Explanation**: for now a template `reason` built from the breakdown ("Meets 3 of 5 must-haves; missing: Java, Spring Boot"). Later (paid tier): 1–2 lines citing resume evidence; reject explanations that mention a skill not in the resume.

`scoring/score.ts` is a pure function with unit tests: same breakdown in → same score out.

## No-invention guard (`tailoring/guard.ts`)

- Build a **fact inventory** from the master resume: skills (with a synonyms map, e.g. `postgres = postgresql`), numbers with units (`%`, `x`, currency, counts), employers, job titles, dates, degrees, certifications.
- After tailoring, extract the same facts from the output. Any number, skill, employer, title, date or degree **not in the inventory → reject**. Retry once with the violation list in the prompt; if it fails again, return the error and the violations to me. Never "fix" by lowering the bar.
- Titles must match the master resume for the same employer and dates.
- LaTeX safety: escape `& % $ # _ { } ~ ^ \` in every inserted string; never emit `\input`, `\include`, `\write18` or shell-escape; generate from a fixed template, the LLM only fills content slots.
- Tests: fixtures with injected fake numbers, fake skills and inflated titles must all be rejected.

## Two modes: automatic and manual

Kira has two front doors to the **same per-job services**:

- **Automatic**: the scheduled pipeline (fetch → filter → embed → score → shortlist → email) over every new job.
- **Manual (UI built later)**: I paste a JD (e.g. one a recruiter sent me in a DM), optionally with company, title and URL. Kira stores it as a job with `source = 'manual'`, then runs the same filter → embed → score → tailoring-suggestion → tailor steps on that one job, on demand, and shows the result. I can re-score after editing the JD or after updating my resume.

Rule for every stage built from now on: **expose a per-job function** (`filterJob(jobId)`, `embedJob(jobId)`, `scoreJob(jobId)`, `suggestTailoring(jobId)`, `tailorResume(jobId)`). The pipeline stage is only a loop over new jobs that calls it; the agent API calls the same function for one job. No logic may live only inside a batch loop. Manual jobs are scored even when a hard filter fails (the result shows which filter failed), because I chose to look at them.

**Tailoring suggestion** (shown on every scored job): does a custom resume help for this JD? Output `{ level: none | light | strong, suggestions: string[] }` with 2–4 concrete edits, each pointing at an existing resume line: move a bullet up, use the JD's wording for a skill I already list, put a matching project first. Requirements I don't meet appear as **gaps**, never as resume edits. Computed from the score breakdown in code where possible; a local LLM may phrase the suggestions.

**Master resume**: my Overleaf LaTeX source (`apps/agent/data/resume/main.tex`, gitignored) is the template for tailoring and the source of truth for the fact inventory. The PDF (`apps/agent/data/resume.pdf`) is only a fallback for text extraction.

## Apply assist (later)

- Playwright with its own browser profile. Fill text fields and dropdowns; **never click Submit**; never touch CAPTCHAs.
- Before drafting, scan for **knock-out questions** (years, degree, visa/sponsorship, salary floor) and warn me if my profile answer is likely an automatic reject.
- If the form's role doesn't match the scored job, stop and ask.
- Save every drafted answer to the application record.

## Data sources: rules

- **OK**: Greenhouse `boards-api.greenhouse.io/v1/boards/{co}/jobs?content=true`; Lever `api.lever.co/v0/postings/{co}?mode=json`; Ashby public posting API; Workday `/wday/cxs/{tenant}/{site}/jobs` (POST; list has no description → fetch detail per job, throttled); PeopleStrong portals `{tenant}.peoplestrong.com/api/cp/rest/altone/cp/jobs/v1` (POST list) + `/job/{slug}/v2` (detail per new job), which answer without cookies or tokens.
- **Never send browser cookies, CSRF tokens or copied session headers** (e.g. from a curl exported from DevTools). If an endpoint only works with them, it is not a public API: skip it.
- **Wipro (`careers.wipro.com`, SuccessFactors)**: its jobs API is under `/services/`, which its `robots.txt` disallows, so it is **not fetched**. Its sitemap and `/job/…` pages are allowed (about 5,900 India postings): a possible later `scrape` adapter.
- **Scraping** (only when no API): public pages only, no login or user cookies, respect `robots.txt`, ≤1 request/second per host with backoff on 429/5xx, honest User-Agent. If a CAPTCHA or bot challenge appears, stop and log it. Never work around it.
- **Do NOT scrape LinkedIn, Naukri, Indeed or Glassdoor** (ToS + account bans). Later: read their job-alert emails via the Gmail API.
- One failing source never stops the run: catch + log per fetcher into `fetch_runs`.
- Reference implementations: career-ops (`~/Projects/career-ops`, MIT) `providers/workday.mjs`, `greenhouse.mjs`, `lever.mjs`, `ashby.mjs` handle real-world quirks (pagination limits, retries, rate limits). Read them before writing an adapter; if code is copied, keep the MIT notice. Don't use the "career-ops" name.

## Dedupe + liveness

- `url_normalized`: lowercase host, strip tracking params (`utm_*`, `gh_src`, `lever-source`…), drop fragments.
- Exact dupes: `(source, external_id)`. Cross-source dupes: `fingerprint = hash(company_norm + title_norm + location_norm)`.
- Reposts: a fingerprint that reappears after `closed_at` → flag (possible ghost job).
- Liveness: re-check before shortlist/email/tailoring (ATS API 404 or "closed" markers → `closed`). Mark jobs not seen for 2 runs as closed.

## Security + privacy

- **JD text is untrusted input** (prompt injection). Wrap it in clear delimiters, tell the model it's data, give scoring/tailoring calls no tools, validate every output with Zod. Never render JD HTML unsanitized in Next.js.
- Master resume and profile are PII: local only, gitignored. Send the paid API only what the task needs.
- Secrets in root `.env` (gitignored): `DATABASE_URL`, `OLLAMA_URL`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, paid API key, `PAID_LLM_BUDGET_USD`.
- Agent and web bind `127.0.0.1` only (no auth layer yet).

## Stack

- Node.js 24 + TypeScript (strict), ESM, `tsx`; npm workspaces
- `apps/agent`: Fastify 5, loads root `.env` via `--env-file-if-exists`
- `apps/web`: Next.js 16 (App Router, `src/`, Tailwind 4)
- PostgreSQL 16 + pgvector via `docker-compose` (standalone binary; the `docker compose` plugin isn't set up on this Mac) (`pgvector/pgvector:pg16`, db `jobagent`) on host port **5433** (5432 is a local Homebrew Postgres 17, not ours); Docker CLI with Colima, no Docker Desktop
- Vitest (agent + shared), pino logs. Integration tests run only when `TEST_DATABASE_URL` is set and wipe that database (must end in `_test`)
- Ollama: `qwen2.5:7b`, `llama3.1:8b`, `nomic-embed-text`
- Zod for every external input (API payloads, LLM output, config)
- Nodemailer (Gmail app password), `pdf-parse` for resume import, Playwright for apply assist

## Commands (root)

```bash
colima start        # Docker runtime
npm run db:up       # Postgres + pgvector (docker-compose; waits until healthy)
npm run db:migrate  # apply pending migrations (-- --status to list)
npm run db:seed     # dev only: fictional rows, empty DB only
npm run db:create-test  # once: create jobagent_test for integration tests
npm run profile:import  # data/profile.json → profile row
npm run resume:import   # data/resume/main.tex (or resume.pdf) → resume version + chunks; prints the sections
npm run filter:report   # pass/fail counts by rule; `-- --refilter` re-runs filters on unscored jobs
npm run similarity:report  # job ranking vs resume; `-- --embed` runs stage [3] first (needs Ollama)
npm run score:report    # scored jobs with their requirement breakdown; `-- --score` runs stages [4]+[5] first (needs Ollama)
npm run eval:label      # label ~50 jobs by hand (y/n + your 0–100) into evals/labeled.json
npm run eval            # score the labelled jobs (no DB writes) and print precision / recall / correlation; `-- --limit=10` for a quick check
npm run dev:agent   # agent in watch mode
npm run run:agent   # run the full pipeline once
npm run dev:web     # dashboard
npm run typecheck   # tsc --noEmit across workspaces
npm test            # unit tests
```

## Conventions

- `Fetcher` (`fetchers/types.ts`) has two halves: `fetch(company, ctx)` does the network I/O and returns the payload as received (archived gzipped in `data/raw/` first); `parse(payload, company)` is pure and returns `{ jobs: RawJob[], sightings, skipped }`. Tests feed fixtures to `parse`; no HTTP mocking of real sites.
- Normalization is separate and pure (`pipeline/normalize.ts`: id, `url_normalized`, fingerprint, hashes). `seniority` and `years_min` are filled by stage [2] rules.
- All outbound HTTP goes through `fetchers/http.ts` with an explicit host allowlist per request; settings in `config/fetch.ts`.
- Each posting is validated on its own (Zod); a bad posting is skipped and counted, never fatal for the board.
- Code ported from career-ops carries a header naming its source; the licence is in `THIRD_PARTY_NOTICES.md`.
- Shared types and Zod schemas come from `packages/shared`; never redefine them in an app.
- Model names, thresholds, weights and cadences come from config/`.env`, never hardcoded.
- Strip HTML before embedding. Chunk instead of truncating; if something must be cut, log it. Ollama calls send `truncate: false`, so over-long input errors instead of being cut silently.
- Keep raw API responses 7 days in `apps/agent/data/raw/` so re-scoring doesn't re-fetch.
- Every prompt has a `prompt_version`; changing a prompt bumps it, so old and new scores can be compared.
- Structured logs (Fastify's pino). `/health` reports DB and Ollama status.
- Nothing is compiled: `tsx` runs the agent and Next compiles `@kira/shared` (`transpilePackages`). Relative imports therefore use **`.ts`** extensions (`allowImportingTsExtensions`), never `.js`; Turbopack can't map `.js` → `.ts`.
- Env is read once through `apps/agent/src/env.ts` (Zod); never read `process.env` elsewhere in the agent.
- The web app loads the root `.env` in `next.config.ts` and reads Postgres through `apps/web/src/lib/db.ts` + `data.ts` (`server-only`); it never writes.
- Next.js 16 runs with Cache Components: every uncached read (DB, fetch, `params`) sits inside `<Suspense>`. Read `apps/web/node_modules/next/dist/docs/` (or root `node_modules/next/dist/docs/`) before using a Next API; it differs from older versions.

## Testing + evals

- Unit tests (Vitest) for core logic: scoring, dedupe/fingerprints, URL normalization, routing + fallback, budget cap, the no-invention guard, status transitions.
- Fetchers: tests against saved fixture payloads, never live APIs in CI.
- Eval set: 40–50 hand-labeled jobs (`would apply: yes/no`, my score). Report precision of the 70+ shortlist and recall of my "yes" jobs. Run it after any change to prompts, models, weights or threshold, and record the result in `PROGRESS.md`.

## Which Claude model to use (building Kira)

Fable 5.2 is stronger but uses my limit much faster than Opus 5.5; save it for hard, multi-file work.

**Fable 5.2**: initial architecture (data model, service boundaries, data flow); the fetch service (adapter interface, Greenhouse/Lever/Ashby/Workday adapters, scheduler, retries, rate limits); the RAG pipeline (chunking, embedding, pgvector schema/indexes, retrieval); the scoring engine; resume tailoring + no-invention guard; refactors touching >3 files; hard bugs Opus failed twice.

**Opus 5.5**: single-file features and small changes; Next.js pages, forms, tables; tracker CRUD APIs; tests for existing code; config, env, Dockerfiles, seed data, scripts; docs and prompt tweaks; small bug fixes, lint and type errors.

## Rules for Claude

- At the start of each task, say whether it's a Fable or an Opus task. If I'm on the wrong model, say so before writing code.
- Fable tasks: one large, well-scoped task per session.
- Before writing a lot of code, propose the design (data model, services, data flow) and wait for my OK.
- Keep modules small and testable; include tests for core logic.
- Point out cost, rate-limit, scraping-ToS and privacy risks when they come up.
- When a requirement is unclear, ask instead of guessing.
<!-- - Git: commit after each completed task with a clear message. Never push; I push myself. -->
- Before ending a session, or when I'm near my limit: update _Current status_ below and append to `PROGRESS.md` (done, next, open decisions) so the next session continues without re-explaining.

## Open decisions

- Paid API provider/model for tailoring, explanations and answers.
- Scheduler: `node-cron` + catch-up on startup (simplest) vs `pg-boss` (Postgres-backed queue, retries, no new infra) vs BullMQ + Redis (most infra; good portfolio talking point).
- RAG framework: custom preferred (~200 lines, better for learning) unless a library clearly saves time.
- Test runner: Vitest assumed.

## Current status

- [x] Monorepo scaffold: `apps/agent` (Fastify `/health`), `apps/web` (default Next.js page), `docker-compose.yml` (pgvector)
- [x] Skeleton (stubs, no domain logic):
  - agent: Zod env, pg pool, `/health` (DB + Ollama, 503 when degraded), `buildApp()` for tests, `runPipeline()` with 8 stub stages (`pipeline/stages.ts`), Vitest (4 tests)
  - web: header + agent health badge, Shortlist, Job detail, Tracker, Profile pages
- [x] Data model: enums + entity Zod schemas, `0001_init.sql`, migration runner (`db:migrate`), dev seed (`db:seed`); web pages read Postgres (`lib/data.ts`).
- [x] Fetch stage: Greenhouse, Lever, PeopleStrong fetchers; companies sync from `companies.json`; raw archive (7 days); `fetch_runs`; normalize + upsert. `npm run run:agent` stores real jobs (first run 2026-11-11: 1,089 jobs from Stripe, Paytm, CRED, BMW TechWorks). The DB now holds **real data**: don't run `db:seed` or wipe the volume casually.
- [x] Stage [2]: profile + master resume import, stale-job closing (2 missed successful runs), duplicate/repost links, hard filters with per-job `dedupeJob` / `filterJob`. On the 1,089 stored jobs: 4 pass, 3 duplicates (2026-11-12). Tune with `data/profile.json` → `profile:import` → `filter:report -- --refilter`.
- [ ] Fetchers still to do: Ashby, Workday. More companies are needed: only ~20 stored jobs are India software roles.
- [x] Stage [3]: chunking, nomic embeddings (local), similarity per job, retrieval, `llm_calls` logging; Ollama down = deferred, not failed. First run 2026-11-15: 1,086 jobs embedded in ~2 min, similarity 0.48–0.74. Spec: `docs/session-b-embeddings.md`.
- [x] Stages [4]+[5]: per-requirement extraction (local `qwen2.5:7b`), code checks, score in code, shortlist at 70, `scoreJob` per job, eval tooling. First real run 2026-11-16: 4 passing jobs scored (51–79), 3 shortlisted. **Eval set not labelled yet** (`npm run eval:label`).
- [ ] Liveness, email digest, scheduler
- [ ] Resume tailoring + no-invention guard
- [ ] Tracker + follow-ups
- [ ] Web dashboard
- [ ] Apply assist

- [ ] Manual mode: paste a JD in the UI → score, tailoring suggestion, custom resume (after tailoring exists)

Local setup: Ollama 0.34 running with `qwen2.5:7b` and `nomic-embed-text` (`llama3.1:8b` fallback not pulled). Personal files are in place under `apps/agent/data/` (gitignored): `profile.json`, `resume/main.tex` (master), `resume.pdf`, `cover-letter.txt`. Never put personal files inside `data/raw/`: that folder is pruned after 7 days.

## Usage notes (temporary; remove after Nov 17, 2026)

- Fable is included in my plan until Nov 16, 2026, and can use up to 50% of my weekly limit. The weekly limit resets Tuesday 9:30 AM IST.
- One "Reset for free" Fable refill, expiring Nov 17, 1:29 PM IST: refills the 5-hour session and the Fable allowance. Use it only if I run out mid-build.
- Priority before Nov 16: finish the Fable tasks (architecture, fetchers, RAG, scoring, tailoring). UI and tracker can follow on Opus.
