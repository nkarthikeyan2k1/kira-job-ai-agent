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
