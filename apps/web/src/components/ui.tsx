import type { JobStatus } from "@kira/shared";
import type { ReactNode } from "react";

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>}
    </div>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 85
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      : score >= 70
        ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <span className={`inline-flex min-w-10 justify-center rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums ${tone}`}>
      {Math.round(score)}
    </span>
  );
}

const STATUS_TONE: Record<JobStatus, string> = {
  found: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  scored: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  shortlisted: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  applied: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  responded: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  interview: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  offer: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  rejected: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  skipped: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  ghosted: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  withdrawn: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  closed: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

export function StatusPill({ status }: { status: JobStatus }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_TONE[status]}`}>
      {status}
    </span>
  );
}

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "bad" }) {
  const toneClass = {
    neutral: "border-zinc-200 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300",
    good: "border-emerald-200 text-emerald-800 dark:border-emerald-900 dark:text-emerald-300",
    bad: "border-rose-200 text-rose-800 dark:border-rose-900 dark:text-rose-300",
  }[tone];
  return <span className={`inline-block rounded-md border px-2 py-0.5 text-xs ${toneClass}`}>{children}</span>;
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      {title && <h2 className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400">{title}</h2>}
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
      {children}
    </div>
  );
}

export function LoadingRows() {
  return <div className="h-40 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />;
}
