# Progress log

Newest entry at the bottom. Each session appends: what was done, what's next, open decisions.

## 2026-11-11

**Done**
- Monorepo scaffold exists: `apps/agent` (Fastify `/health`), `apps/web` (default Next.js page), `docker-compose.yml` (Postgres 16 + pgvector).
- `CLAUDE.md` rewritten: workflow, architecture, data model, LLM routing, scoring design, no-invention guard, source rules, testing/evals, model-usage rules.

**Next**
- Local setup: `colima start`, `npm run db:up`, `ollama pull qwen2.5:7b`, `ollama pull nomic-embed-text`.
- Fable session: design review of the data model + `packages/shared` (types, Zod schemas, first migration), then Greenhouse + Lever fetchers.

**Open decisions**
- Paid API provider/model.
- Scheduler: node-cron vs pg-boss vs BullMQ + Redis.

## 2026-11-11 (skeleton, Opus)

**Done**
- `packages/shared` (`@kira/shared`, TS source): application statuses, ATS types, `RequirementResultSchema`, `HealthResponseSchema`, provisional view types for the dashboard.
- Agent: Zod-validated env, pg pool, `/health` checking DB + Ollama (503 when degraded), `buildApp()` split from `server.ts`, `runPipeline()` running 8 stub stages in architecture order (`npm run run:agent`), Vitest with 4 passing tests.
- Web: header with live agent-health badge, Shortlist / Job detail / Tracker / Profile pages on sample data via `src/lib/data.ts`; production build passes with Cache Components.
- Switched relative imports to `.ts` extensions (Turbopack can't resolve `.js` → `.ts` in workspace packages).
- Docker Postgres moved to host port 5433: a Homebrew `postgresql@17` already listens on 5432.

**Next (Fable)**
- Design review: data model + first migration in `packages/shared`, replacing the provisional `views.ts` types and the web-local `Profile`.
- Then: migration runner, Greenhouse + Lever fetchers (read career-ops providers first), replacing the `fetch` stub stage.

**Open decisions**
- Paid API provider/model.
- Scheduler: node-cron vs pg-boss vs BullMQ + Redis.
- Stages currently share no in-memory state; suggested: they communicate through Postgres so each can be re-run alone. Confirm in the design review.

## 2026-11-11 (data model, Fable)

**Done**
- `npm run db:up` fixed: scripts call the standalone `docker-compose`, with a healthcheck + `--wait`.
- `packages/shared`: `enums.ts`, one Zod schema per table in `entities/`, Zod-backed read models (`views.ts`), `parseRows`/`camelizeRow`.
- `0001_init.sql`: 11 tables, HNSW indexes on `jobs` and `job_chunks`, named CHECKs mirroring the shared enums.
- Migration runner (`npm run db:migrate`, `-- --status`): forward-only, advisory lock, checksum check, one transaction per file.
- Web reads Postgres (`lib/db.ts`, `lib/data.ts`); sample data and banner removed. Dev seed: `npm run db:seed`.
- Tests: 38 passing (migration planning, row mapping, entity schemas, integration test on `jobagent_test` incl. enum-vs-CHECK drift).
- Verified on a fresh volume: migrate applies, second run is a no-op; typecheck, lint, web build pass.

**Decisions made (differ from the earlier CLAUDE.md, now updated there)**
- Job unique key is `(source, company_id, external_id)`.
- `matches` is append-only with `is_current`; `final_score` stored 0–100.
- `applications` rows start at `shortlisted`; the Shortlist page lists jobs that have an application row (no threshold in the web app).
- `profile` is a single-row table.

**Next (Fable)**
- Greenhouse + Lever fetchers: `Fetcher`/`RawJob` types, HTTP helper, `companies.json` schema + sync into `companies`, per-ATS `ats_config` shape, `fetch_runs` logging. Read career-ops providers first.
- Before the first real fetch: `docker-compose down -v && npm run db:up && npm run db:migrate` to drop the dev-seed rows.

**Open decisions**
- Paid API provider/model.
- Scheduler: node-cron vs pg-boss vs BullMQ + Redis.
- Seniority bands (`intern…manager`) and `tier` meaning (1 = top target) are my defaults; change by migration if wrong.
- Agent API routes for profile/tracker writes are not built.

## 2026-11-11 (fetch stage, Fable)

**Done**
- Fetchers: Greenhouse, Lever, PeopleStrong (new ATS type, migration `0002`). `Fetcher` = `fetch` (network, payload archived as received) + `parse` (pure).
- `fetchers/http.ts`: host allowlist, HTTPS only, no redirects, 1 req/s per host, timeout, 50 MB body cap, 2 retries with backoff + jitter, clamped `Retry-After`.
- HTML → text port (`lib/`) keeps headings, paragraphs and list items; handles Greenhouse's double-encoded bodies.
- `config/companies.json` (Zod-validated) synced into `companies`; removed companies are disabled, not deleted.
- Fetch stage: per-company try/catch, `fetch_runs` row per attempt, raw payloads gzipped in `data/raw/<day>/` and pruned after 7 days, pure `normalizeJob`, upsert that keeps `first_seen` and clears the embedding when the description changes.
- Tests: 110 passing (fixtures are trimmed real payloads; DB integration on `jobagent_test`; no live calls).
- Live run (once): Stripe 779, Paytm 201, CRED 14, BMW TechWorks 95 = 1,089 jobs, 0 errors, about 2 minutes (BMW needs one detail request per new job). 311 India postings. Dev-seed rows were truncated first.
- Ported code credited in file headers + `THIRD_PARTY_NOTICES.md` (career-ops, MIT).

**Not done / known limits**
- **Wipro not fetched**: its jobs API is under `/services/`, disallowed by its `robots.txt`. Options: skip, or a later `scrape` adapter over its sitemap + `/job/…` pages (allowed, ~5,900 India postings, slow at 1 req/s).
- PeopleStrong: detail is fetched only for new postings, so a later edit to a stored posting's description is not picked up.
- `seniority`, `years_min` are null (need JD parsing). `jobs_closed` is always 0: closing jobs after 2 missed runs belongs to the dedupe/liveness work.
- No replay command for archived payloads yet (done once by hand after a parser fix).
- Changes are uncommitted, by request.

**Next (Fable)**
- Dedupe + hard filters (stage 2), including closing jobs not seen for 2 runs. Needs a real profile row first (the fictional one was removed).
- Then the RAG pipeline: chunking by section, embeddings, retrieval.

**Open decisions**
- Wipro: skip or sitemap scraper.
- Which more companies to add to `companies.json` (verify each board token with one request).
- Paid API provider/model; scheduler choice.

## 2026-11-12 (stage 2: profile, resume, dedupe, hard filters; Fable)

**Done**
- Migration `0003`: `manual` source, `jobs.duplicate_of` / `repost_of`, profile columns for the filters (`work_auth` text replaced by `work_auth_countries`), `matches` check relaxed for unenforced (manual) results.
- `npm run profile:import` (gitignored `data/profile.json`, strict Zod) and `npm run resume:import` (LaTeX → text → chunks; PDF fallback; unchanged file = no-op; old version is re-activated, not duplicated).
- My real resume (`main.tex`) imported as version 1: 8 chunks (contact, summary, skills, 2 jobs, 2 projects, education), no embeddings yet.
- Stage [2] wired into the pipeline: `closeStaleJobs` (set-based), per-job `dedupeJob` and `filterJob`. `filterJob` also fills `jobs.seniority` and `jobs.years_min` by rules.
- Hard filters (pure, `pipeline/filters.ts`): title, location, seniority, years, visa, salary, dealBreakers. Mechanics in `config/scoring.ts`.
- `npm run filter:report` (+ `-- --refilter`).
- Parser fixes found on real data: Lever "0–0" salary is a placeholder; Greenhouse "N/A" location now falls back to offices (Stripe's were US/Canada); "New Grad" = entry level.
- Tests: 209 passing (unit for every rule/parser; integration on `jobagent_test`).

**Result on the 1,089 stored jobs** (profile: 4.8 yrs, mid/senior, Bengaluru/Chennai/Hyderabad/Pune/Coimbatore, floor ₹14 LPA)
- 4 pass, 1,082 fail, 3 duplicates. Fails by rule: title 991, location 886, seniority 533, years 422.
- Near misses (one rule only): title 79, location 63, years 8, seniority 2. In India: 4 Stripe Bengaluru SWE roles asking 7–8 years; 1 Paytm backend role in Noida; BMW DevOps / Data / CI roles (title).
- Seniority could be read from 550 titles, years from 936 descriptions; salary is stated on none.

**Known limits**
- Only one fetch run exists, so stale-closing has not fired on real data (covered by tests).
- Archived payloads were re-parsed by a throwaway script after the parser fixes; a proper `fetch:replay` command is still missing.
- `data/profile.json` title keywords, cities and levels are my defaults; Karthikeyan has not tuned them yet.
- Resume says "4.10 years" (meaning 4 years 10 months); the PDF says 4.8. The `.tex` is the source of truth for the fact inventory.
- A shortlisted application is not yet moved to `closed` when its posting closes (tracker work).
- Changes are uncommitted, by request.

**Next (Fable): RAG session B**
- `ai/llm-client.ts` + routing, JD chunking by section, embeddings for job + resume chunks, `embedJob`, similarity top-N. Input set: jobs whose current match passed (or is unenforced). With only 4 passing jobs, add companies or loosen the profile first, or the similarity ranking has nothing to rank.

**Open decisions**
- More companies (India product companies on Greenhouse/Lever/Ashby); Wipro skip vs sitemap scraper.
- Paid API provider/model; scheduler choice.

## 2026-11-14 (Session B design; Fable, design only)

**Done**
- Stage [3] design approved and written as a build spec: `docs/session-b-embeddings.md` (measured Ollama facts, chunking rules, signatures, SQL, tests, verification).
- Decided: embed every open job (not only passing ones); normalise similarity over all embedded jobs; leave `jobs.embedding` NULL; keep the 8 resume chunks.

**Next**
- **Opus**: implement `docs/session-b-embeddings.md` in a fresh session (no redesign needed).
- **Fable** (budget is shared with a new trading-terminal project, so design only): Session C scoring design, Session D tailoring-guard design, each written as a spec for Opus to build.

**Open decisions**
- Unchanged: more companies, paid API provider, scheduler, Wipro.

## 2026-11-15 (Session B built; Opus)

**Done**
- Stage [3] built from `docs/session-b-embeddings.md`: `ai/chunk.ts`, `ai/ollama.ts`, `ai/llm-client.ts` (routing, prefix, 1 retry, `llm_calls` row per attempt), `ai/embed.ts` (`embedJob`, `embedResume`), `ai/retrieve.ts` (`similarityForJob`, `retrieveResumeChunks`, `normalizeSimilarities`), `pipeline/embed-stage.ts`, `npm run similarity:report`.
- Real run: 1,086 jobs embedded in ~2 min (1,084 Ollama calls, 0 failures, avg 74 ms); 1,083 similarities (basis: requirements 1,052, responsibilities 23, other 8); raw 0.48–0.74, median 0.61. A second run re-embeds nothing.
- Passing jobs ranked: BMW Java Backend 0.717, Paytm Senior SE Backend 0.708, Paytm Backend TL 0.671, BMW Automotive SE 0.671.
- Tests: 260 passing (chunker on Stripe/Paytm/BMW/CRED shapes, LLM client with fake transport, 11 integration tests with a fake embedder).

**Deviations from the spec (small)**
- Chunker: "label: value" lines ("Experience: 4-8 years") are content, not headings (they were being dropped); headings may end with "?" ("what is CRED?").
- Resume contact chunk is skipped by content (email/phone pattern), not by `other#0` position.
- The stage recomputes similarity for every embedded job each run (cheap SQL), not only newly embedded ones, so a new resume version updates all similarities.

**Finding for Session C**
- Similarity measures topic, not role fit: the overall top 20 is mostly Paytm fintech business/product roles, and the resume **summary** chunk is the best match for most jobs (it is a broad "fintech, payments, trading" paragraph). Among passing jobs the ranking is sensible. Options: drop the summary from similarity, or keep it and let the per-requirement LLM step decide. Hard filters already remove off-role jobs.

**Next**
- Session C (scoring): design, then build.

## 2026-11-16 (Session C built; Opus)

**Done**
- Stages [4] + [5]: `llm-client.generateJson` (Ollama `/api/chat` with a JSON schema, temperature 0, seed 1, `num_ctx` 8192; retry once on unreachable and once on invalid output; refuses a prompt that filled the window), prompt `extract-requirements/v1` (JD as data in `<JOB>`, whole resume in `<RESUME>`, delimiter tags stripped), `scoring/verify.ts`, `scoring/score.ts`, `computeJobScore` / `scoreJob` (append-only match, shortlist + application event at ≥ 70), stage "score" (top 30 passing by similarity + all manual jobs; Ollama down = deferred; unusable answer = job skipped, retried next run).
- Eval: `npm run eval:label` (interactive, mixes passing / near-miss / rejected jobs), `npm run eval` (dry run, precision, recall, Spearman, MAE, a summary line for this file). `evals/labeled.json` is empty.
- `npm run score:report` (`-- --score`).
- Tests: 293 passing (verify, score maths, eval metrics, prompt, generateJson with a fake transport, 7 integration tests with a fake model).

**First real run** (4 passing jobs, ~2.5 min)
- 78.6 BMW QCP Java Backend (shortlisted) · 74.8 Paytm Senior SE Backend (shortlisted) · 70.4 Paytm Backend TL/STL (shortlisted) · 51.1 BMW Automotive SE + AI (not).
- Quotes are real but sometimes **irrelevant**: e.g. "Kubernetes: met" citing the payments bullet. Verification only checks that a quote exists, not that it supports the requirement.
- Scores look **too generous for Java roles**: the core stack (Java/Quarkus, Java/Spring Boot) is missing, yet many generic must-haves ("clean code", "Git", "problem solving") are met. Paytm TL also counts a "Tier 1/2 degree" as met.

**Next**
- **Karthikeyan**: label ~50 jobs (`npm run eval:label`, ~30 min), then `npm run eval` for the baseline numbers.
- Likely first tuning (measure with eval before and after): (1) evidence must share a keyword with its requirement, else `partial`; (2) cap the score when the posting's primary language/framework is missing; (3) prompt v2 asking the model to merge generic soft-skill lines.
- Session D (tailoring + guard): design.

**Open decisions**
- Unchanged: more companies, paid API provider, scheduler, Wipro.
