import Link from "next/link";
import { Suspense } from "react";
import type { ApplicationRow, ApplicationStatus } from "@kira/shared";
import { EmptyState, LoadingRows, PageHeader, StatusPill } from "@/components/ui";
import { getApplications } from "@/lib/data";
import { formatDate, jobHref } from "@/lib/format";

export default function TrackerPage() {
  return (
    <>
      <PageHeader title="Tracker" description="Every application, from applied to outcome." />
      <Suspense fallback={<LoadingRows />}>
        <ApplicationsTable />
      </Suspense>
    </>
  );
}

async function ApplicationsTable() {
  const applications = await getApplications();
  if (applications.length === 0) return <EmptyState>No applications yet.</EmptyState>;

  return (
    <>
      <StatusCounts applications={applications} />
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Applied</th>
              <th className="px-4 py-2 font-medium">Next follow-up</th>
              <th className="px-4 py-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {applications.map((a) => (
              <tr key={a.jobId}>
                <td className="px-4 py-3">
                  <Link href={jobHref(a.jobId)} className="font-medium hover:underline">
                    {a.title}
                  </Link>
                  <div className="text-xs text-zinc-500">{a.company}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={a.status} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-zinc-500">{formatDate(a.appliedAt)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-zinc-500">{formatDate(a.nextFollowUpAt)}</td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{a.notes ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StatusCounts({ applications }: { applications: ApplicationRow[] }) {
  const counts = new Map<ApplicationStatus, number>();
  for (const a of applications) counts.set(a.status, (counts.get(a.status) ?? 0) + 1);

  return (
    <div className="mb-4 flex flex-wrap gap-3">
      {[...counts].map(([status, count]) => (
        <div key={status} className="flex items-center gap-2 text-sm">
          <StatusPill status={status} />
          <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{count}</span>
        </div>
      ))}
    </div>
  );
}
