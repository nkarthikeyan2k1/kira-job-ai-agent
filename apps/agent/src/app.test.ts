import { describe, expect, it } from "vitest";
import type { HealthResponse } from "@kira/shared";
import { buildApp } from "./app.ts";

const healthy = async () => {};
const down = async () => {
  throw new Error("connection refused");
};

describe("GET /health", () => {
  it("returns 200 and ok when every check passes", async () => {
    const app = buildApp({ healthChecks: { db: healthy, ollama: healthy } });

    const res = await app.inject({ method: "GET", url: "/health" });
    const body = res.json<HealthResponse>();

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.db?.ok).toBe(true);
  });

  it("returns 503 and names the failing dependency", async () => {
    const app = buildApp({ healthChecks: { db: healthy, ollama: down } });

    const res = await app.inject({ method: "GET", url: "/health" });
    const body = res.json<HealthResponse>();

    expect(res.statusCode).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.ollama).toMatchObject({ ok: false, error: "connection refused" });
    expect(body.checks.db?.ok).toBe(true);
  });
});
