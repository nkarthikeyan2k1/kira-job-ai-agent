import { describe, expect, it } from "vitest";
import { decideDedupe, type DedupeJob } from "./dedupe.ts";

const day = (n: number) => new Date(Date.UTC(2026, 10, n));
const job = (overrides: Partial<DedupeJob> = {}): DedupeJob => ({
  id: "gh:acme:2",
  source: "greenhouse",
  fingerprint: "same",
  descriptionHash: "text-a",
  firstSeen: day(10),
  closedAt: null,
  duplicateOf: null,
  ...overrides,
});

describe("decideDedupe", () => {
  it("links nothing when the job stands alone", () => {
    expect(decideDedupe(job(), [])).toEqual({ duplicateOf: null, repostOf: null });
  });

  it("treats the same posting on another board as a duplicate of the older one", () => {
    const onLever = job({ id: "lv:acme:x", source: "lever", descriptionHash: "formatted-differently", firstSeen: day(5) });
    expect(decideDedupe(job(), [onLever]).duplicateOf).toBe("lv:acme:x");
  });

  it("treats an identical posting on the same board as a duplicate", () => {
    expect(decideDedupe(job(), [job({ id: "gh:acme:1", firstSeen: day(5) })]).duplicateOf).toBe("gh:acme:1");
  });

  it("keeps two postings on one board with different text: they are different openings", () => {
    expect(decideDedupe(job(), [job({ id: "gh:acme:1", descriptionHash: "text-b", firstSeen: day(5) })]).duplicateOf).toBeNull();
  });

  it("makes the older job the original, breaking ties by id", () => {
    expect(decideDedupe(job({ firstSeen: day(1) }), [job({ id: "gh:acme:9", firstSeen: day(5) })]).duplicateOf).toBeNull();
    expect(decideDedupe(job(), [job({ id: "gh:acme:1" })]).duplicateOf).toBe("gh:acme:1");
    expect(decideDedupe(job({ id: "gh:acme:1" }), [job({ id: "gh:acme:2" })]).duplicateOf).toBeNull();
  });

  it("picks the oldest of several originals and never one that is itself a copy or closed", () => {
    const others = [
      job({ id: "gh:acme:c", firstSeen: day(3) }),
      job({ id: "gh:acme:a", firstSeen: day(2) }),
      job({ id: "gh:acme:copy", firstSeen: day(1), duplicateOf: "gh:acme:a" }),
      job({ id: "gh:acme:closed", firstSeen: day(1), closedAt: day(4) }),
    ];
    expect(decideDedupe(job(), others).duplicateOf).toBe("gh:acme:a");
  });

  it("flags a repost when an identical posting was closed before this one appeared", () => {
    const closed = job({ id: "gh:acme:old", firstSeen: day(1), closedAt: day(6) });
    const closedEarlier = job({ id: "gh:acme:older", firstSeen: day(1), closedAt: day(3) });
    expect(decideDedupe(job(), [closedEarlier, closed])).toEqual({ duplicateOf: null, repostOf: "gh:acme:old" });
  });

  it("does not call it a repost when the other posting closed after this one appeared", () => {
    expect(decideDedupe(job(), [job({ id: "gh:acme:old", firstSeen: day(1), closedAt: day(12) })]).repostOf).toBeNull();
  });
});
