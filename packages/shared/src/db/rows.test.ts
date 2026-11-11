import { describe, expect, it } from "vitest";
import { z } from "zod";
import { camelizeRow, parseRows } from "./rows.ts";

describe("camelizeRow", () => {
  it("renames snake_case columns to camelCase", () => {
    expect(camelizeRow({ job_id: "a", next_follow_up_at: null, title: "t" })).toEqual({
      jobId: "a",
      nextFollowUpAt: null,
      title: "t",
    });
  });

  it("leaves nested jsonb values untouched", () => {
    const breakdown = [{ some_key: 1 }];
    expect(camelizeRow({ hard_filter_result: { failed_rules: [] }, breakdown })).toEqual({
      hardFilterResult: { failed_rules: [] },
      breakdown,
    });
  });
});

describe("parseRows", () => {
  const schema = z.object({ jobId: z.string(), finalScore: z.number() });

  it("returns typed camelCase rows", () => {
    expect(parseRows(schema, [{ job_id: "gh:acme:1", final_score: 88 }])).toEqual([{ jobId: "gh:acme:1", finalScore: 88 }]);
  });

  it("throws when a row doesn't match the schema", () => {
    expect(() => parseRows(schema, [{ job_id: "gh:acme:1", final_score: "high" }])).toThrow();
  });
});
