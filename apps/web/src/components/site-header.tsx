import Link from "next/link";
import { Suspense } from "react";
import { getAgentHealth } from "@/lib/agent";

const NAV = [
  { href: "/", label: "Shortlist" },
  { href: "/tracker", label: "Tracker" },
  { href: "/profile", label: "Profile" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Kira
        </Link>
        <nav className="flex gap-4 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <Suspense fallback={<StatusDot tone="idle" label="Checking agent…" />}>
            <AgentStatus />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

async function AgentStatus() {
  const result = await getAgentHealth();
  if (!result.reachable) return <StatusDot tone="bad" label="Agent offline" title={result.error} />;

  const failing = Object.entries(result.health.checks)
    .filter(([, check]) => !check.ok)
    .map(([name]) => name);
  return failing.length === 0 ? (
    <StatusDot tone="good" label="Agent OK" />
  ) : (
    <StatusDot tone="warn" label={`Down: ${failing.join(", ")}`} />
  );
}

function StatusDot({ tone, label, title }: { tone: "good" | "warn" | "bad" | "idle"; label: string; title?: string }) {
  const color = { good: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-rose-500", idle: "bg-zinc-400" }[tone];
  return (
    <span className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400" title={title}>
      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden />
      {label}
    </span>
  );
}
