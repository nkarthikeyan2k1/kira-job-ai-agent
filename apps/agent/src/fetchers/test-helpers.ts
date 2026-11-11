import { readFileSync } from "node:fs";
import type { Company } from "@kira/shared";
import { pino } from "pino";
import type { HttpClient, JsonRequest } from "./http.ts";
import type { FetchContext } from "./types.ts";

/** A saved, trimmed real payload from src/fetchers/__fixtures__/. */
export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8"));
}

export function company(overrides: Partial<Company> = {}): Company {
  const now = new Date("2026-11-12T00:00:00Z");
  return {
    id: "acme",
    name: "Acme",
    ats: "greenhouse",
    atsKey: "acme",
    atsConfig: {},
    careersUrl: "https://example.com/careers",
    enabled: true,
    tier: 2,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** An HttpClient that records requests and answers from a function instead of the network. */
export function fakeHttp(reply: (url: string, request: JsonRequest) => unknown) {
  const requests: { url: string; request: JsonRequest }[] = [];
  const http: HttpClient = {
    async getJson(url, request) {
      requests.push({ url, request });
      return reply(url, request);
    },
  };
  return { http, requests };
}

export function fetchContext(http: HttpClient, knownExternalIds: string[] = []): FetchContext {
  return { http, knownExternalIds: new Set(knownExternalIds), log: pino({ level: "silent" }) };
}
