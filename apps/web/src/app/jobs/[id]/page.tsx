import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Card, Chip, LoadingRows, ScoreBadge, StatusPill } from "@/components/ui";
import { getMatch } from "@/lib/data";

export default function JobPage({ params }: PageProps<"/jobs/[id]">) {
  return (
    <>
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← Shortlist
      </Link>
      <Suspense fallback={<LoadingRows />}>{params.then(({ id }) => <JobDetail jobId={decodeURIComponent(id)} />)}</Suspense>
    </>
  );
}

async function JobDetail({ jobId }: { jobId: string }) {
  const match = await getMatch(jobId);
  if (!match) notFound();

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{match.title}</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {match.company} · {match.location ?? "Location not stated"}
            {match.remoteType && <span className="capitalize"> · {match.remoteType}</span>}
          </p>
          <div className="mt-2">
            <StatusPill status={match.status} />
          </div>
        </div>
        <a
          href={match.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Open posting ↗
        </a>
      </div>

      <Card title="Score">
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <ScoreBadge score={match.finalScore} /> <span className="text-zinc-500">final</span>
          </div>
          <div>
            <span className="font-medium tabular-nums">{Math.round(match.similarity * 100)}%</span>{" "}
            <span className="text-zinc-500">similarity</span>
          </div>
          <div>
            <span className="font-medium tabular-nums">{match.llmScore}</span>{" "}
            <span className="text-zinc-500">requirements score</span>
          </div>
        </div>
        <p className="mt-3 text-sm">{match.reason}</p>
      </Card>

      <Card title="Skills">
        <div className="flex flex-wrap gap-1.5">
          {match.matchedSkills.map((s) => (
            <Chip key={s} tone="good">
              {s}
            </Chip>
          ))}
          {match.missingSkills.map((s) => (
            <Chip key={s} tone="bad">
              missing: {s}
            </Chip>
          ))}
        </div>
      </Card>

      <Card title="Requirements vs resume">
        <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-900">
          {match.breakdown.map((r) => (
            <li key={r.requirement} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={r.status === "met" ? "good" : r.status === "missing" ? "bad" : "neutral"}>{r.status}</Chip>
                <span className="text-xs uppercase text-zinc-400">{r.weight}</span>
                <span>{r.requirement}</span>
              </div>
              {r.evidence && <blockquote className="mt-1 border-l-2 border-zinc-200 pl-3 text-xs text-zinc-500 dark:border-zinc-700">{r.evidence}</blockquote>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
