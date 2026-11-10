import { HealthResponseSchema, type HealthResponse } from "@kira/shared";

const AGENT_URL = process.env.AGENT_URL ?? "http://127.0.0.1:4000";

export type AgentHealth =
  | { reachable: true; health: HealthResponse }
  | { reachable: false; error: string };

export async function getAgentHealth(): Promise<AgentHealth> {
  try {
    // /health answers 503 when a dependency is down; the body is still valid.
    const res = await fetch(new URL("/health", AGENT_URL), { signal: AbortSignal.timeout(2_000) });
    return { reachable: true, health: HealthResponseSchema.parse(await res.json()) };
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}
