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
