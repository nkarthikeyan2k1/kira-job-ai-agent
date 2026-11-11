const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

export function formatDate(date: Date | null): string {
  return date ? dateFormat.format(date) : "—";
}

export function jobHref(jobId: string): string {
  return `/jobs/${encodeURIComponent(jobId)}`;
}
