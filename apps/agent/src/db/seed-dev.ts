import { createHash } from "node:crypto";
import type { ApplicationStatus, RemoteType, RequirementResult } from "@kira/shared";
import { pino } from "pino";
import { loadEnv } from "../env.ts";
import { createPool } from "./client.ts";

// DEV ONLY (`npm run db:seed`): fictional companies and postings so the
// dashboard has rows before the real pipeline exists. Refuses to run when the
// jobs table already has data.

interface SeedJob {
  id: string;
  company: { id: string; name: string; ats: string };
  externalId: string;
  title: string;
  location: string;
  remoteType: RemoteType;
  daysAgo: number;
  similarity: number;
  llmScore: number;
  finalScore: number;
  reason: string;
  matchedSkills: string[];
  missingSkills: string[];
  breakdown: RequirementResult[];
  application: { status: ApplicationStatus; appliedDaysAgo?: number; followUpInDays?: number; notes?: string };
}

const EVIDENCE = "Sample evidence quote from the resume.";

const JOBS: SeedJob[] = [
  {
    id: "gh:northwind:4011",
    company: { id: "northwind", name: "Northwind Payments", ats: "greenhouse" },
    externalId: "4011",
    title: "Senior Full-Stack Engineer, Merchant Platform",
    location: "Bengaluru",
    remoteType: "hybrid",
    daysAgo: 2,
    similarity: 0.82,
    llmScore: 91,
    finalScore: 88,
    reason: "Strong overlap on Node.js/TypeScript services and PostgreSQL in a payments domain.",
    matchedSkills: ["Node.js", "TypeScript", "React", "PostgreSQL", "Redis"],
    missingSkills: ["Kafka"],
    breakdown: [
      { requirement: "5+ years building web applications with TypeScript", weight: "must", status: "met", evidence: EVIDENCE },
      { requirement: "Experience with PostgreSQL at scale", weight: "must", status: "met", evidence: EVIDENCE },
      { requirement: "Payments or fintech domain", weight: "nice", status: "met", evidence: EVIDENCE },
      { requirement: "Event streaming with Kafka", weight: "nice", status: "missing", evidence: null },
    ],
    application: { status: "shortlisted" },
  },
  {
    id: "lv:contoso:a7f2",
    company: { id: "contoso", name: "Contoso Markets", ats: "lever" },
    externalId: "a7f2",
    title: "Backend Engineer, Trading Systems",
    location: "Remote (India)",
    remoteType: "remote",
    daysAgo: 5,
    similarity: 0.77,
    llmScore: 88,
    finalScore: 84,
    reason: "Real-time trading background matches the low-latency order flow work.",
    matchedSkills: ["Node.js", "TypeScript", "Redis", "Docker"],
    missingSkills: ["Go"],
    breakdown: [
      { requirement: "Low-latency, real-time systems", weight: "must", status: "met", evidence: EVIDENCE },
      { requirement: "Go or Rust in production", weight: "nice", status: "missing", evidence: null },
    ],
    application: { status: "applied", appliedDaysAgo: 4, followUpInDays: 3 },
  },
  {
    id: "wd:fabrikam:R-20931",
    company: { id: "fabrikam", name: "Fabrikam", ats: "workday" },
    externalId: "R-20931",
    title: "Software Engineer III, Web Platform",
    location: "Hyderabad",
    remoteType: "onsite",
    daysAgo: 1,
    similarity: 0.71,
    llmScore: 79,
    finalScore: 76,
    reason: "Good React/Next.js fit; JD asks for more design-system ownership than the resume shows.",
    matchedSkills: ["React", "Next.js", "TypeScript"],
    missingSkills: ["Design systems", "Accessibility audits"],
    breakdown: [
      { requirement: "Production React and Next.js", weight: "must", status: "met", evidence: EVIDENCE },
      { requirement: "Owned a component library or design system", weight: "must", status: "partial", evidence: EVIDENCE },
    ],
    application: { status: "shortlisted" },
  },
  {
    id: "as:tailspin:0c91",
    company: { id: "tailspin", name: "Tailspin Labs", ats: "ashby" },
    externalId: "0c91",
    title: "Full-Stack Engineer, AI Products",
    location: "Remote (APAC)",
    remoteType: "remote",
    daysAgo: 10,
    similarity: 0.69,
    llmScore: 74,
    finalScore: 72,
    reason: "Stack matches; applied AI experience is lighter than the JD asks for.",
    matchedSkills: ["TypeScript", "Node.js", "PostgreSQL"],
    missingSkills: ["LLM evaluation", "Python"],
    breakdown: [
      { requirement: "Shipped LLM-backed features", weight: "must", status: "partial", evidence: EVIDENCE },
      { requirement: "Python", weight: "nice", status: "missing", evidence: null },
    ],
    application: { status: "interview", appliedDaysAgo: 9, notes: "Tech screen booked." },
  },
];

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const daysFromNow = (days: number | undefined) => (days === undefined ? null : new Date(Date.now() + days * 86_400_000));

const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL });
const pool = createPool(env.DATABASE_URL);
const client = await pool.connect();

try {
  const existing = await client.query("SELECT 1 FROM jobs LIMIT 1");
  if (existing.rowCount) throw new Error("jobs already has rows; the dev seed only runs on an empty database");

  await client.query("BEGIN");

  const resume = await client.query<{ id: number }>(
    "INSERT INTO resume_versions (label, content, content_hash, is_active) VALUES ($1, $2, $3, true) RETURNING id",
    ["dev-seed", "Placeholder resume text (dev seed).", sha("dev-seed-resume")],
  );
  const resumeVersionId = resume.rows[0]!.id;

  await client.query(
    `INSERT INTO profile (target_roles, skills, experience_years, seniority, remote_types)
     VALUES ($1, $2, 5, 'senior', $3)`,
    [
      ["Senior Full-Stack Engineer", "Senior Backend Engineer"],
      ["Node.js", "TypeScript", "React", "Next.js", "PostgreSQL", "Redis", "Docker", "Microservices"],
      ["remote", "hybrid"],
    ],
  );

  for (const job of JOBS) {
    const url = `https://example.com/jobs/${job.company.id}-${job.externalId}`;
    const description = `${job.title} at ${job.company.name}. Placeholder description (dev seed).`;
    const firstSeen = daysFromNow(-job.daysAgo);

    await client.query("INSERT INTO companies (id, name, ats, ats_key, careers_url) VALUES ($1, $2, $3, $1, $4)", [
      job.company.id,
      job.company.name,
      job.company.ats,
      `https://example.com/careers/${job.company.id}`,
    ]);
    await client.query(
      `INSERT INTO jobs (id, company_id, source, external_id, url, url_normalized, fingerprint, title, location,
                         location_norm, remote_type, description, description_hash, first_seen, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, lower($9), $10, $11, $12, $13, now())`,
      [job.id, job.company.id, job.company.ats, job.externalId, url, url.replace("https://", ""), sha(`${job.company.id}|${job.title}|${job.location}`), job.title, job.location, job.remoteType, description, sha(description), firstSeen],
    );
    await client.query(
      `INSERT INTO matches (job_id, resume_version_id, hard_filter_result, similarity, similarity_norm, llm_score,
                            final_score, breakdown, matched_skills, missing_skills, reason, model, prompt_version)
       VALUES ($1, $2, '{"passed": true, "failed": []}', $3, $3, $4, $5, $6, $7, $8, $9, 'dev-seed', 'dev-seed')`,
      [job.id, resumeVersionId, job.similarity, job.llmScore, job.finalScore, JSON.stringify(job.breakdown), job.matchedSkills, job.missingSkills, job.reason],
    );

    const { status, appliedDaysAgo, followUpInDays, notes } = job.application;
    const application = await client.query<{ id: number }>(
      "INSERT INTO applications (job_id, status, applied_at, next_follow_up_at, notes) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [job.id, status, appliedDaysAgo === undefined ? null : daysFromNow(-appliedDaysAgo), daysFromNow(followUpInDays), notes ?? null],
    );
    await client.query("INSERT INTO application_events (application_id, from_status, to_status, note) VALUES ($1, NULL, $2, 'dev seed')", [
      application.rows[0]!.id,
      status,
    ]);
  }

  await client.query("COMMIT");
  log.info({ jobs: JOBS.length }, "dev seed inserted");
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  log.fatal({ err }, "dev seed failed");
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
