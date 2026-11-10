import type { ApplicationRow, MatchDetail } from "@kira/shared";

// SAMPLE DATA. Fictional companies and postings so the UI can be built before
// the agent writes real rows. Delete this file once lib/data.ts reads Postgres.

export const SAMPLE_MATCHES: MatchDetail[] = [
  {
    jobId: "gh:northwind:4011",
    company: "Northwind Payments",
    title: "Senior Full-Stack Engineer, Merchant Platform",
    location: "Bengaluru",
    remoteType: "hybrid",
    url: "https://example.com/jobs/northwind-4011",
    finalScore: 88,
    similarity: 0.82,
    llmScore: 91,
    reason: "Strong overlap on Node.js/TypeScript services and PostgreSQL in a payments domain.",
    status: "shortlisted",
    firstSeen: "2026-11-09",
    matchedSkills: ["Node.js", "TypeScript", "React", "PostgreSQL", "Redis"],
    missingSkills: ["Kafka"],
    breakdown: [
      { requirement: "5+ years building web applications with TypeScript", weight: "must", status: "met", evidence: "Sample evidence quote from the resume." },
      { requirement: "Experience with PostgreSQL at scale", weight: "must", status: "met", evidence: "Sample evidence quote from the resume." },
      { requirement: "Payments or fintech domain", weight: "nice", status: "met", evidence: "Sample evidence quote from the resume." },
      { requirement: "Event streaming with Kafka", weight: "nice", status: "missing", evidence: null },
    ],
  },
  {
    jobId: "lv:contoso:a7f2",
    company: "Contoso Markets",
    title: "Backend Engineer, Trading Systems",
    location: "Remote (India)",
    remoteType: "remote",
    url: "https://example.com/jobs/contoso-a7f2",
    finalScore: 84,
    similarity: 0.77,
    llmScore: 88,
    reason: "Real-time trading background matches the low-latency order flow work.",
    status: "applied",
    firstSeen: "2026-11-06",
    matchedSkills: ["Node.js", "TypeScript", "Redis", "Docker"],
    missingSkills: ["Go"],
    breakdown: [
      { requirement: "Low-latency, real-time systems", weight: "must", status: "met", evidence: "Sample evidence quote from the resume." },
      { requirement: "Go or Rust in production", weight: "nice", status: "missing", evidence: null },
    ],
  },
  {
    jobId: "wd:fabrikam:R-20931",
    company: "Fabrikam",
    title: "Software Engineer III, Web Platform",
    location: "Hyderabad",
    remoteType: "onsite",
    url: "https://example.com/jobs/fabrikam-R-20931",
    finalScore: 76,
    similarity: 0.71,
    llmScore: 79,
    reason: "Good React/Next.js fit; JD asks for more design-system ownership than the resume shows.",
    status: "shortlisted",
    firstSeen: "2026-11-10",
    matchedSkills: ["React", "Next.js", "TypeScript"],
    missingSkills: ["Design systems", "Accessibility audits"],
    breakdown: [
      { requirement: "Production React and Next.js", weight: "must", status: "met", evidence: "Sample evidence quote from the resume." },
      { requirement: "Owned a component library or design system", weight: "must", status: "partial", evidence: "Sample evidence quote from the resume." },
    ],
  },
  {
    jobId: "as:tailspin:0c91",
    company: "Tailspin Labs",
    title: "Full-Stack Engineer, AI Products",
    location: "Remote (APAC)",
    remoteType: "remote",
    url: "https://example.com/jobs/tailspin-0c91",
    finalScore: 72,
    similarity: 0.69,
    llmScore: 74,
    reason: "Stack matches; applied AI experience is lighter than the JD asks for.",
    status: "interview",
    firstSeen: "2026-11-01",
    matchedSkills: ["TypeScript", "Node.js", "PostgreSQL"],
    missingSkills: ["LLM evaluation", "Python"],
    breakdown: [
      { requirement: "Shipped LLM-backed features", weight: "must", status: "partial", evidence: "Sample evidence quote from the resume." },
      { requirement: "Python", weight: "nice", status: "missing", evidence: null },
    ],
  },
];

export const SAMPLE_APPLICATIONS: ApplicationRow[] = [
  {
    jobId: "lv:contoso:a7f2",
    company: "Contoso Markets",
    title: "Backend Engineer, Trading Systems",
    status: "applied",
    appliedAt: "2026-11-07",
    nextFollowUpAt: "2026-11-14",
    notes: null,
  },
  {
    jobId: "as:tailspin:0c91",
    company: "Tailspin Labs",
    title: "Full-Stack Engineer, AI Products",
    status: "interview",
    appliedAt: "2026-11-02",
    nextFollowUpAt: null,
    notes: "Tech screen booked.",
  },
  {
    jobId: "gh:adatum:7781",
    company: "Adatum",
    title: "Senior Frontend Engineer",
    status: "ghosted",
    appliedAt: "2026-10-12",
    nextFollowUpAt: null,
    notes: "No reply after 2 follow-ups.",
  },
];

// Provisional profile shape; the real one will be defined in @kira/shared
// together with the hard filters that read it.
export interface Profile {
  targetRoles: string[];
  skills: string[];
  experienceYears: number | null;
  locations: string[];
  salaryRange: string | null;
  workAuth: string | null;
  dealBreakers: string[];
  resumeVersion: string | null;
}

export const SAMPLE_PROFILE: Profile = {
  targetRoles: ["Senior Full-Stack Engineer", "Senior Backend Engineer"],
  skills: ["Node.js", "TypeScript", "React", "Next.js", "PostgreSQL", "Redis", "Docker", "Microservices"],
  experienceYears: 5,
  locations: [],
  salaryRange: null,
  workAuth: null,
  dealBreakers: [],
  resumeVersion: null,
};
