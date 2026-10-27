# Job AI Agent

Personal AI agent that fetches MNC job listings, compares them to my resume, and emails me jobs scoring 70+.
Two goals: (1) speed up my job search, (2) learn applied AI (embeddings, vector DB, RAG, LLMs) by building it.

## Who I am (for context)

- Full stack dev, 4+ yrs, React / TypeScript / Node.js / PostgreSQL, fintech + algo trading.
- New to AI. When you write AI-related code, briefly explain the concept (embedding, cosine similarity, RAG, tokens) in a comment or reply.

## Repo layout: monorepo (npm workspaces)

One repo, two apps, one shared package. Postgres + pgvector is the bridge between the apps.

| App / package     | Does                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| `apps/agent`      | Node + TS **Fastify API** (port 4000) + worker: fetch, embed, score, email, cron. All the AI work. |
| `apps/web`        | Next.js dashboard. API routes only **read** from Postgres.           |
| `packages/shared` | `Job` / `Match` types, Zod schemas, DB schema. Written once, used by both. |

- Do NOT put agent logic inside Next.js. The agent is long-running (cron, Ollama calls that take minutes); Next.js is for short request/response work.
- Build `apps/agent` first (Days 1–5). Add `apps/web` only after the agent sends real matches.

## Architecture (apps/agent)

```
cron (daily / every 2 days)
  → [1] Fetchers: Workday, Greenhouse, Lever, (later) Gmail job-alert emails
  → [2] Normalize + dedupe + hard filters (Postgres)
  → [3] Embed JDs → pgvector → cosine similarity vs resume → top 30
  → [4] RAG scoring: per job, retrieve top 3 resume chunks → LLM → JSON score
  → [5] final = 0.4 * similarity + 0.6 * llm_score/100 ; keep >= 0.70
  → [6] Output: Markdown/CSV report + email digest
```

## Stack

- Node.js 24 + TypeScript 5 (strict), run with `tsx`; npm workspaces
- `apps/agent`: Fastify 5, ESM (`"type": "module"`), loads root `.env` via `--env-file-if-exists`
- `apps/web`: Next.js 16 (App Router, `src/`, Tailwind 4), port 3000
- Ollama (local, MacBook Air M5, 16 GB RAM)
  - LLM: `qwen2.5:7b` (fallback `llama3.1:8b`), temperature 0 for scoring
  - Embeddings: `nomic-embed-text` (768 dims)
- PostgreSQL 16 + pgvector via `docker compose` (Docker CLI, no Docker Desktop), image `pgvector/pgvector:pg16`, db `jobagent`
- Zod for validating LLM JSON output
- `node-cron` for scheduling, Nodemailer (Gmail app password) for email
- `pdf-parse` for resume
- Later: Next.js for `apps/web`

## Commands (root)

```bash
npm run db:up       # docker compose up -d (Postgres + pgvector)
npm run dev:agent   # agent in watch mode
npm run run:agent   # run the full pipeline once
npm run dev:web     # Next.js dashboard
npm run typecheck   # tsc --noEmit across all workspaces
```

## Data sources — rules

- OK: Workday `/wday/cxs/{tenant}/{site}/jobs` (POST), Greenhouse `boards-api.greenhouse.io/v1/boards/{co}/jobs?content=true`, Lever `api.lever.co/v0/postings/{co}?mode=json`, Ashby posting API.
- Do NOT scrape LinkedIn / Naukri / Indeed. Use their job-alert emails via Gmail API instead (v2).
- Company list lives in `apps/agent/config/companies.json`, not in code.

## Data model (`packages/shared/src/db/schema.sql`)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,              -- e.g. gh:{board}:{jobId}, wd:{tenant}:{jobId}
  source TEXT NOT NULL,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  is_remote BOOLEAN DEFAULT false,
  description TEXT NOT NULL,        -- cleaned plain text
  url TEXT NOT NULL,
  embedding vector(768),
  first_seen TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE resume_chunks (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  embedding vector(768)
);

CREATE TABLE matches (
  job_id TEXT REFERENCES jobs(id),
  similarity REAL,
  llm_score INT,
  final_score REAL,
  matched_skills TEXT[],
  missing_skills TEXT[],
  reason TEXT,
  scored_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (job_id)
);
```

## LLM output contract

```json
{ "score": 0-100, "matched_skills": [], "missing_skills": [], "reason": "1-2 lines citing resume evidence" }
```

Zod schema lives in `packages/shared`. Always validate; on invalid JSON retry once, then log and skip.

## Folder structure

```
job-ai-agent/
├── CLAUDE.md
├── README.md
├── package.json              # npm workspaces + root scripts
├── docker-compose.yml        # Postgres + pgvector
├── .env                      # gitignored
├── apps/
│   ├── agent/                # Node worker (build first)
│   │   ├── src/
│   │   │   ├── fetchers/     # one file per source, all implement Fetcher
│   │   │   ├── pipeline/     # normalize.ts, dedupe.ts, filter.ts
│   │   │   ├── ai/           # embed.ts, retrieve.ts, score.ts, prompts.ts
│   │   │   ├── db/           # client.ts
│   │   │   ├── output/       # report.ts, email.ts
│   │   │   ├── server.ts     # Fastify entry (GET /health)
│   │   │   ├── index.ts      # runs the full pipeline once
│   │   │   └── cron.ts       # schedules index.ts
│   │   ├── config/companies.json
│   │   ├── data/resume.pdf   # gitignored
│   │   ├── data/raw/         # raw API responses, kept 7 days, gitignored
│   │   └── evals/labeled.json  # 20 hand-labeled jobs for threshold tuning
│   └── web/                  # Next.js dashboard (after agent works)
└── packages/
    └── shared/
        └── src/              # types.ts, schemas.ts (Zod), db/schema.sql
```

## Conventions

- `interface Fetcher { name: string; fetch(): Promise<Job[]> }` — adding a company = config change, not new code.
- Shared types (`Job`, `Match`) and Zod schemas are imported from `packages/shared`, never redefined in an app.
- One failing source must not stop the run: catch + log per fetcher.
- Strip HTML from JDs before embedding; trim very long JDs to fit the context window.
- Keep raw API responses for 7 days (`apps/agent/data/raw/`) so re-scoring doesn't need re-fetching.
- Model names, thresholds and weights come from `.env` / config, not hardcoded.
- Secrets in root `.env` (gitignored): DATABASE_URL, GMAIL_USER, GMAIL_APP_PASSWORD, OLLAMA_URL.

## Build plan

- Day 1: monorepo scaffold + docker compose; fetchers (2 Workday + 2 Greenhouse), normalize, save to Postgres
- Day 2: resume → chunks; embed jobs + chunks; pgvector similarity query
- Day 3: RAG scoring prompt + Zod validation; final score formula
- Day 4: dedupe, filters, email digest, cron
- Day 5: eval set (20 labeled jobs), tune threshold, README + diagram + demo GIF
- After: `apps/web` dashboard reading `matches` from Postgres

## Status

- [ ] Day 1
- [ ] Day 2
- [ ] Day 3
- [ ] Day 4
- [ ] Day 5
- [ ] Web dashboard
