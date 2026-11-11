// Query parameters that only track where a click came from.
const TRACKING_PARAMS = new Set(["gh_src", "lever-source", "lever-origin", "fbclid", "gclid", "mc_cid", "mc_eid"]);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
}

/**
 * Canonical form of a posting URL, so the same posting reached through
 * different links compares equal: lowercase host, no fragment, no tracking
 * parameters, remaining parameters sorted, no trailing slash.
 */
export function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const params = [...url.searchParams.entries()]
    .filter(([name]) => !isTrackingParam(name))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(params).toString();
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host.toLowerCase()}${path}${query ? `?${query}` : ""}`;
}
