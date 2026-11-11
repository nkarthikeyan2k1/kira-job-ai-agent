import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, LoadingRows, PageHeader, ScoreBadge, StatusPill } from "@/components/ui";
import { getShortlist } from "@/lib/data";
import { formatDate, jobHref } from "@/lib/format";

export default function ShortlistPage() {
  return (
    <>
      <PageHeader title="Shortlist" description="Jobs the agent shortlisted against your resume, highest score first." />
      <Suspense fallback={<LoadingRows />}>
        <ShortlistTable />
      </Suspense>
    </>
  );
}

async function ShortlistTable() {
  const matches = await getShortlist();
  if (matches.length === 0) return <EmptyState>No matches yet. Run the agent to fetch and score jobs.</EmptyState>;

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
          <tr>
            <th className="px-4 py-2 font-medium">Score</th>
            <th className="px-4 py-2 font-medium">Role</th>
            <th className="px-4 py-2 font-medium">Location</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Found</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
          {matches.map((m) => (
            <tr key={m.jobId} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
              <td className="px-4 py-3">
                <ScoreBadge score={m.finalScore} />
              </td>
              <td className="px-4 py-3">
                <Link href={jobHref(m.jobId)} className="font-medium hover:underline">
                  {m.title}
                </Link>
                <div className="text-xs text-zinc-500">{m.company}</div>
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                {m.location ?? "—"}
                {m.remoteType && <span className="ml-1 text-xs capitalize text-zinc-400">· {m.remoteType}</span>}
              </td>
              <td className="px-4 py-3">
                <StatusPill status={m.status} />
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-zinc-500">{formatDate(m.firstSeen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
