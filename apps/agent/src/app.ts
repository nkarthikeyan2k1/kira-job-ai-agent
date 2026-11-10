import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { HealthResponse } from "@kira/shared";
import { runCheck, type HealthCheck } from "./health.ts";

export interface AppDeps {
  healthChecks: Record<string, HealthCheck>;
}

// Builds the app without listening, so tests can drive it with app.inject().
export function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(opts);

  app.get("/health", async (_req, reply) => {
    const entries = await Promise.all(
      Object.entries(deps.healthChecks).map(async ([name, check]) => [name, await runCheck(check)] as const),
    );
    const ok = entries.every(([, result]) => result.ok);
    const body: HealthResponse = { status: ok ? "ok" : "degraded", checks: Object.fromEntries(entries) };
    return reply.code(ok ? 200 : 503).send(body);
  });

  return app;
}
