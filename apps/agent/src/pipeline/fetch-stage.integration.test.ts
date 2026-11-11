import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type pg from "pg";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CompanyConfig } from "../config/companies.ts";
import { createMigratedTestPool, TEST_DATABASE_URL } from "../db/test-db.ts";
import { greenhouseFetcher } from "../fetchers/greenhouse.ts";
import type { HttpClient } from "../fetchers/http.ts";
import { fixture } from "../fetchers/test-helpers.ts";
import type { Fetcher } from "../fetchers/types.ts";
import { runFetchStage, type FetchStageDeps } from "./fetch-stage.ts";

// End-to-end through Postgres with fake fetchers: nothing here uses the network.
const log = pino({ level: "silent" });
const neverHttp: HttpClient = {
  async getJson() {
    throw new Error("test: the network must not be used");
  },
};

const config = (id: string, ats: CompanyConfig["ats"]): CompanyConfig => ({
  id,
  name: id,
  ats,
  atsKey: id,
  atsConfig: {},
  careersUrl: "https://example.com/careers",
  enabled: true,
  tier: 2,
});

type Board = { jobs: Record<string, unknown>[] };
const board = () => structuredClone(fixture("greenhouse-board.json")) as Board;

describe.skipIf(!TEST_DATABASE_URL)("fetch stage against Postgres", () => {
  let db: pg.Pool;
  let rawDir: string;
  let payload: Board;

  // Greenhouse parsing is real; only the network call is replaced.
  const greenhouse: Fetcher = { ...greenhouseFetcher, fetch: async () => payload };
  const brokenLever: Fetcher = {
    ats: "lever",
    fetch: async () => {
      throw new Error("HTTP 503 from api.lever.co");
    },
    parse: () => ({ jobs: [], sightings: [], skipped: 0 }),
  };
  // Lists two postings without detail, the way a paginated source re-sees stored jobs.
  const sightingsOnly: Fetcher = {
    ats: "peoplestrong",
    fetch: async () => ({}),
    parse: () => ({ jobs: [], sightings: ["8262032", "8172510"], skipped: 0 }),
  };

  const deps = (overrides: Partial<FetchStageDeps> = {}): FetchStageDeps => ({
    db,
    log,
    http: neverHttp,
    fetchers: { greenhouse, lever: brokenLever },
    companies: [config("stripe", "greenhouse"), config("paytm", "lever"), config("someco", "workday")],
    rawDir,
    rawRetentionDays: 7,
    ...overrides,
  });

  beforeAll(async () => {
    db = await createMigratedTestPool();
    rawDir = await mkdtemp(path.join(tmpdir(), "kira-fetch-"));
    payload = board();
  });

  afterAll(async () => {
    await db.end();
    await rm(rawDir, { recursive: true, force: true });
  });

  it("stores one company's jobs even though another company fails", async () => {
    const results = await runFetchStage(deps());

    expect(results).toEqual([
      { companyId: "paytm", ats: "lever", seen: 0, new: 0, updated: 0, skipped: 0, error: "HTTP 503 from api.lever.co" },
      { companyId: "stripe", ats: "greenhouse", seen: 3, new: 3, updated: 0, skipped: 0, error: null },
    ]);

    const jobs = await db.query("SELECT id, company_id, source, title, location, url_normalized FROM jobs ORDER BY id");
    expect(jobs.rows).toHaveLength(3);
    expect(jobs.rows[2]).toEqual({
      id: "gh:stripe:8262032",
      company_id: "stripe",
      source: "greenhouse",
      title: "Bridge Product Accountant",
      location: "Bengaluru",
      url_normalized: "https://stripe.com/jobs/search?gh_jid=8262032",
    });
  });

  it("records every attempt in fetch_runs, with the error for the failed one", async () => {
    const { rows } = await db.query("SELECT company_id, jobs_seen, jobs_new, error, finished_at IS NOT NULL AS finished FROM fetch_runs ORDER BY company_id");

    expect(rows).toEqual([
      { company_id: "paytm", jobs_seen: 0, jobs_new: 0, error: "HTTP 503 from api.lever.co", finished: true },
      { company_id: "stripe", jobs_seen: 3, jobs_new: 3, error: null, finished: true },
    ]);
  });

  it("archives the raw payload of a successful fetch only", async () => {
    const [day] = await readdir(rawDir);
    const files = await readdir(path.join(rawDir, day!));

    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^stripe-\d{6}\.json\.gz$/);
  });

  it("on the next run updates known jobs, keeps first_seen and re-embeds only changed descriptions", async () => {
    await db.query("UPDATE jobs SET embedding_model = 'nomic-embed-text', first_seen = '2026-01-01', closed_at = now()");
    payload = board();
    payload.jobs[0]!.content = "<p>A rewritten description.</p>"; // posting 8262032

    const results = await runFetchStage(deps());

    expect(results.find((r) => r.companyId === "stripe")).toMatchObject({ seen: 3, new: 0, updated: 3 });
    const { rows } = await db.query(
      "SELECT id, description, embedding_model, closed_at, first_seen::date::text AS first_seen FROM jobs ORDER BY id",
    );
    expect(rows.map((r) => r.first_seen)).toEqual(["2026-01-01", "2026-01-01", "2026-01-01"]);
    expect(rows.every((r) => r.closed_at === null)).toBe(true); // seen again → re-opened
    expect(rows.map((r) => [r.id, r.embedding_model])).toEqual([
      ["gh:stripe:8172510", "nomic-embed-text"],
      ["gh:stripe:8201690", "nomic-embed-text"],
      ["gh:stripe:8262032", null],
    ]);
    expect(rows[2].description).toBe("A rewritten description.");
  });

  it("refreshes last_seen for sightings without touching the stored description", async () => {
    await db.query("UPDATE jobs SET last_seen = '2026-01-01'");

    const results = await runFetchStage(
      deps({ fetchers: { peoplestrong: sightingsOnly }, companies: [{ ...config("stripe", "peoplestrong") }] }),
    );

    expect(results).toEqual([{ companyId: "stripe", ats: "peoplestrong", seen: 2, new: 0, updated: 0, skipped: 0, error: null }]);
    const { rows } = await db.query("SELECT external_id, last_seen > '2026-06-01' AS refreshed FROM jobs ORDER BY external_id");
    expect(rows).toEqual([
      { external_id: "8172510", refreshed: true },
      { external_id: "8201690", refreshed: false },
      { external_id: "8262032", refreshed: true },
    ]);
  });

  it("disables companies removed from the config instead of deleting them", async () => {
    const { rows } = await db.query("SELECT id, enabled FROM companies ORDER BY id");

    expect(rows).toEqual([
      { id: "paytm", enabled: false },
      { id: "someco", enabled: false },
      { id: "stripe", enabled: true },
    ]);
  });
});
