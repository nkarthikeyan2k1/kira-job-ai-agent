# Kira — AI job-search platform

## Who I am

Full-stack engineer (~5 years): Node.js, TypeScript, React/Next.js, PostgreSQL, microservices, Redis, Docker, real-time trading systems. Kira is a personal project: it runs my own job search and is a portfolio piece. Write production-quality code I could walk through in an interview.

I'm newer to applied AI. When you write AI code (embeddings, cosine similarity, chunking, RAG, tokens, prompt design), explain the concept briefly in a comment or in your reply.

## What Kira does

An AI job-search assistant: finds relevant jobs, scores how well each matches my profile, tailors my resume for good matches, and tracks every application to an outcome. **Kira prepares; I decide and submit.**

1. **Profile**: target roles, skills, experience level, preferred locations, salary range, visa/work-auth, deal-breakers, and my master resume.
2. **Company sources**: target companies (large MNCs, strong product companies), each with its careers URL and ATS type. Adding a company is a config change, not new code.
3. **Job fetching** (daily or every 2 days): public ATS APIs first (Greenhouse, Lever, Ashby, Workday). Scrape only public pages with no API, under the rules in *Data sources*. Archive the full JD text at first fetch; postings disappear and I'll need them at interview time.
4. **Normalize → dedupe → hard filters** before any AI work (filters are free; LLM calls are not).
5. **Embedding**: master resume and JDs are chunked by section, embedded with `nomic-embed-text`, stored in pgvector.
6. **RAG matching + scoring** (0–100): retrieve relevant resume evidence per job requirement; score skills, seniority, location, salary, domain; store the score, the per-requirement breakdown and a short "why it matches / what's missing".
7. **Liveness check**: confirm the posting is still open before shortlisting, tailoring or emailing it.
8. **Shortlist**: 70+ only, sorted by score; email digest and/or exported file (Markdown/CSV).
9. **Resume tailoring**: LaTeX I can open in Overleaf. **Never invent experience, skills, titles or numbers**: only reorder, reword and emphasise what's in the master resume. Enforced in code (see *No-invention guard*).
10. **Apply assist**: pre-fill forms with my details and tailored answers. **Never clicks Submit. No mass auto-apply.**
11. **Tracking + follow-up**: status history, dates, notes, follow-up reminders.

## Architecture

Monorepo (npm workspaces). Postgres + pgvector is the bridge between apps.

| App / package     | Does |
| ----------------- | ---- |
| `apps/agent`      | Fastify API (port 4000) + worker: fetch, embed, score, tailor, email, scheduler. All AI work. |
| `apps/web`        | Next.js dashboard (port 3000): shortlist, tracker, profile. Reads Postgres; writes only tracker/profile CRUD through the agent API. |
| `packages/shared` | `Job` / `Match` / `Application` types, Zod schemas, SQL schema + migrations. Defined once, imported everywhere. |

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
  fetchers/      # one file per ATS, all implement Fetcher
  pipeline/      # normalize.ts, dedupe.ts, filters.ts, liveness.ts
  ai/            # embed.ts, chunk.ts, retrieve.ts, prompts/, llm-client.ts
  scoring/       # extract.ts, score.ts (pure), explain.ts
  tailoring/     # latex.ts, fact-inventory.ts, guard.ts
  apply/         # playwright prefill (later)
  tracker/       # status transitions, follow-up cadence
  db/            # client.ts, queries
  output/        # report.ts, email.ts
  scheduler.ts, server.ts, index.ts (runs the pipeline once)
apps/agent/config/
  companies.json      # target companies
  llm-routing.ts      # task → local/paid routing (single source of truth)
  scoring.ts          # weights, threshold, hard-filter rules
  follow-ups.ts       # cadence
apps/agent/evals/labeled.json   # hand-labeled jobs for tuning
apps/agent/data/                # gitignored: resume.pdf, raw/, output/
```

## Data model (`packages/shared/src/db/`)

Use migrations (numbered SQL files), never ad-hoc `ALTER`s.

- `companies`: name, ats (`greenhouse|lever|ashby|workday|scrape`), ats_key / tenant, careers_url, enabled, tier.
- `jobs`: id (`gh:{board}:{id}`, `wd:{tenant}:{id}`), company_id, source, external_id, url, url_normalized (unique), fingerprint, title, location, location_norm, remote_type, seniority, years_min, salary_min / salary_max / currency (only when the source states them; never inferred), description (clean text), description_hash, posted_at, first_seen, last_seen, closed_at, embedding `vector(768)`.
- `job_chunks`: job_id, section (`requirements|responsibilities|about|benefits`), content, embedding.
- `resume_versions` + `resume_chunks`: version, section, content, embedding. Scores record which resume version they used.
- `matches`: job_id, resume_version, similarity, similarity_norm, llm_score, final_score, breakdown `jsonb` (per requirement: weight, met/partial/missing, evidence quote), matched_skills, missing_skills, reason, hard_filter_result, model, prompt_version, scored_at.
- `applications`: job_id, status, applied_at, next_follow_up_at, follow_up_count, resume_path, notes.
- `application_events`: application_id, from_status, to_status, at, note. Never overwrite history; analytics come from here.
- `llm_calls`: task, tier, model, tokens_in, tokens_out, cost_usd, latency_ms, ok, error, created_at. Cost tracking and daily budget.
- `fetch_runs`: company_id, started_at, finished_at, seen, new, closed, error.

Indexes: HNSW on embeddings (`vector_cosine_ops`); unique `url_normalized` and `(source, external_id)`; btree on `fingerprint`, `final_score`, `applications.next_follow_up_at`.

Statuses: `found → scored → shortlisted → applied → responded → interview → offer | rejected`, plus `skipped` (my decision), `ghosted` (no reply after max follow-ups), `withdrawn`, `closed` (posting gone). Transitions are validated in one place (`tracker/`), not scattered.

## LLM routing (`apps/agent/config/llm-routing.ts`)

Every LLM call goes through `ai/llm-client.ts` with a task name; routing comes from the config, so moving a task between tiers changes one line.

| Task | Tier | Notes |
| --- | --- | --- |
| JD parsing (sections, requirements, years, seniority) | local | |
| keyword extraction + match vs profile | local | |
| per-requirement first-pass scoring | local | output is evidence, not a final number |
| dedup "same job?" check for near-duplicates | local | only when fingerprints collide |
| final match explanation (shortlist only) | paid | |
| resume tailoring (LaTeX) | paid | passes through the no-invention guard |
| application answers | paid | |

- **Local** (Ollama, MacBook Air M5, 16 GB): `qwen2.5:7b` (fallback `llama3.1:8b`), temperature 0 for scoring. Embeddings: `nomic-embed-text` (768 dims). Larger models won't fit next to dev tools.
- **Paid** (TBD; see *Open decisions*). If Claude: send no `temperature` / `top_p` (rejected on current API versions), use structured outputs validated with Zod, check `stop_reason` (handle `refusal` and `max_tokens`), cache the stable prefix (instructions + master resume) with prompt caching, and use the Batch API (≈50% cheaper) for overnight non-urgent tailoring.
- **Timeouts + fallback**: every local call has a timeout and one retry. If Ollama is down (Mac asleep, low RAM), **defer the job to the next run**; don't silently send high-volume tasks to the paid tier. A task may fall back to paid only if its route says so, and only under the daily budget cap.
- **Budget cap**: daily `PAID_LLM_BUDGET_USD` in `.env`, checked against `llm_calls` before every paid call; over the cap → queue, don't call.

### Ollama gotchas

- Set `num_ctx` explicitly on every call (e.g. 8192). The default is small, and longer input is **truncated silently**.
- `nomic-embed-text` needs task prefixes: `search_document: ` for JD chunks, `search_query: ` for resume chunks/queries. Without them retrieval quality drops.
- Keep one model loaded at a time; `keep_alive` tuned so the 7B model doesn't evict and reload between jobs.

## Scoring design

1. **Hard filters (free, before embedding)**: title keywords (positive/negative), location/remote policy, seniority band, years required vs mine, visa/no-sponsorship statements, salary floor when stated. Failing a hard filter stores `hard_filter_result` and stops; no LLM call.
2. **Similarity**: cosine similarity of the JD requirements chunk vs resume chunks. nomic scores cluster in a narrow band (~0.5–0.8), so **rescale per run (min-max) before mixing**, and keep only the top-N for LLM work.
3. **Per-requirement extraction (local LLM)**: for each JD requirement → `{ requirement, weight: must|nice, status: met|partial|missing, evidence: "<exact quote from resume>" }`. Weight comes from the JD's own wording ("required", "must", "nice to have"). Evidence must be a quote that exists in the resume (check in code; drop it if not found).
4. **Score in code, not by the LLM**: a 7B model's raw 0–100 is noisy. `llm_score` = weighted share of met/partial requirements; `final = w_sim · similarity_norm + w_llm · llm_score/100` plus dimension adjustments (seniority, location, salary, domain). Weights and threshold live in `config/scoring.ts`; start at `0.4 / 0.6` and tune on the eval set.
5. **Explanation**: 1–2 lines citing resume evidence. Reject explanations that mention a skill not in the resume.

`scoring/score.ts` is a pure function with unit tests: same breakdown in → same score out.

## No-invention guard (`tailoring/guard.ts`)

- Build a **fact inventory** from the master resume: skills (with a synonyms map, e.g. `postgres = postgresql`), numbers with units (`%`, `x`, currency, counts), employers, job titles, dates, degrees, certifications.
- After tailoring, extract the same facts from the output. Any number, skill, employer, title, date or degree **not in the inventory → reject**. Retry once with the violation list in the prompt; if it fails again, return the error and the violations to me. Never "fix" by lowering the bar.
- Titles must match the master resume for the same employer and dates.
- LaTeX safety: escape `& % $ # _ { } ~ ^ \` in every inserted string; never emit `\input`, `\include`, `\write18` or shell-escape; generate from a fixed template, the LLM only fills content slots.
- Tests: fixtures with injected fake numbers, fake skills and inflated titles must all be rejected.

## Apply assist (later)

- Playwright with its own browser profile. Fill text fields and dropdowns; **never click Submit**; never touch CAPTCHAs.
- Before drafting, scan for **knock-out questions** (years, degree, visa/sponsorship, salary floor) and warn me if my profile answer is likely an automatic reject.
- If the form's role doesn't match the scored job, stop and ask.
- Save every drafted answer to the application record.

## Data sources: rules

- **OK**: Greenhouse `boards-api.greenhouse.io/v1/boards/{co}/jobs?content=true`; Lever `api.lever.co/v0/postings/{co}?mode=json`; Ashby public posting API; Workday `/wday/cxs/{tenant}/{site}/jobs` (POST; list has no description → fetch detail per job, throttled).
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
- PostgreSQL 16 + pgvector via `docker compose` (`pgvector/pgvector:pg16`, db `jobagent`) on host port **5433** (5432 is a local Homebrew Postgres 17, not ours); Docker CLI with Colima, no Docker Desktop
- Vitest (agent tests), pino logs
- Ollama: `qwen2.5:7b`, `llama3.1:8b`, `nomic-embed-text`
- Zod for every external input (API payloads, LLM output, config)
- Nodemailer (Gmail app password), `pdf-parse` for resume import, Playwright for apply assist

## Commands (root)

```bash
colima start        # Docker runtime
npm run db:up       # Postgres + pgvector
npm run dev:agent   # agent in watch mode
npm run run:agent   # run the full pipeline once
npm run dev:web     # dashboard
npm run typecheck   # tsc --noEmit across workspaces
npm test            # unit tests
npm run eval        # score the labeled set and print metrics
```

## Conventions

- `interface Fetcher { name: string; fetch(company: Company): Promise<RawJob[]> }`; normalization is separate from fetching.
- Shared types and Zod schemas come from `packages/shared`; never redefine them in an app.
- Model names, thresholds, weights and cadences come from config/`.env`, never hardcoded.
- Strip HTML before embedding. Chunk instead of truncating; if something must be cut, log it.
- Keep raw API responses 7 days in `apps/agent/data/raw/` so re-scoring doesn't re-fetch.
- Every prompt has a `prompt_version`; changing a prompt bumps it, so old and new scores can be compared.
- Structured logs (Fastify's pino). `/health` reports DB and Ollama status.
- Nothing is compiled: `tsx` runs the agent and Next compiles `@kira/shared` (`transpilePackages`). Relative imports therefore use **`.ts`** extensions (`allowImportingTsExtensions`), never `.js`; Turbopack can't map `.js` → `.ts`.
- Env is read once through `apps/agent/src/env.ts` (Zod); never read `process.env` elsewhere in the agent.
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
- Git: commit after each completed task with a clear message. Never push; I push myself.
- Before ending a session, or when I'm near my limit: update *Current status* below and append to `PROGRESS.md` (done, next, open decisions) so the next session continues without re-explaining.

## Open decisions

- Paid API provider/model for tailoring, explanations and answers.
- Scheduler: `node-cron` + catch-up on startup (simplest) vs `pg-boss` (Postgres-backed queue, retries, no new infra) vs BullMQ + Redis (most infra; good portfolio talking point).
- RAG framework: custom preferred (~200 lines, better for learning) unless a library clearly saves time.
- Test runner: Vitest assumed.

## Current status

- [x] Monorepo scaffold: `apps/agent` (Fastify `/health`), `apps/web` (default Next.js page), `docker-compose.yml` (pgvector)
- [x] Skeleton (stubs, no domain logic):
  - agent: Zod env, pg pool, `/health` (DB + Ollama, 503 when degraded), `buildApp()` for tests, `runPipeline()` with 8 stub stages (`pipeline/stages.ts`), Vitest (4 tests)
  - web: header + agent health badge, Shortlist, Job detail, Tracker, Profile pages; all data from `src/lib/data.ts` → **sample data** (`src/lib/sample-data.ts`, delete once Postgres is wired)
  - shared: statuses, ATS types, `RequirementResultSchema`, `HealthResponseSchema`, provisional view types (`views.ts`)
- [ ] `packages/shared`: real `Job` / `Match` / `Application` / `Company` / `Profile` schemas, migrations
- [ ] Fetchers: Greenhouse, Lever, Ashby, Workday
- [ ] Normalize, dedupe, hard filters
- [ ] Embedding + pgvector retrieval
- [ ] Scoring engine + eval set
- [ ] Liveness, email digest, scheduler
- [ ] Resume tailoring + no-invention guard
- [ ] Tracker + follow-ups
- [ ] Web dashboard
- [ ] Apply assist

Local setup still needed: add `"cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"]` to `~/.docker/config.json` so `docker compose` finds the Homebrew plugin (until then, `docker-compose up -d` works), `ollama pull qwen2.5:7b`, `ollama pull nomic-embed-text` (only `qwen2.5-coder:7b-instruct` is installed). Done: `.env`, Compose 5.7 installed, DB up on 5433 with pgvector 0.8.7. `npm run eval` doesn't exist yet.

## Usage notes (temporary; remove after Nov 17, 2026)

- Fable is included in my plan until Nov 16, 2026, and can use up to 50% of my weekly limit. The weekly limit resets Tuesday 9:30 AM IST.
- One "Reset for free" Fable refill, expiring Nov 17, 1:29 PM IST: refills the 5-hour session and the Fable allowance. Use it only if I run out mid-build.
- Priority before Nov 16: finish the Fable tasks (architecture, fetchers, RAG, scoring, tailoring). UI and tracker can follow on Opus.
