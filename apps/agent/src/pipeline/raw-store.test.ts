import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pruneRawPayloads, saveRawPayload } from "./raw-store.ts";

let rawDir: string;
beforeEach(async () => {
  rawDir = await mkdtemp(path.join(tmpdir(), "kira-raw-"));
});
afterEach(async () => {
  await rm(rawDir, { recursive: true, force: true });
});

describe("saveRawPayload", () => {
  it("writes the payload gzipped under a folder named after the day", async () => {
    const payload = { jobs: [{ id: 1, title: "Engineer — Zürich" }] };

    const file = await saveRawPayload(rawDir, "stripe", payload, new Date("2026-11-12T08:15:30Z"));

    expect(path.relative(rawDir, file)).toBe(path.join("2026-11-12", "stripe-081530.json.gz"));
    expect(JSON.parse(gunzipSync(await readFile(file)).toString("utf8"))).toEqual(payload);
  });
});

describe("pruneRawPayloads", () => {
  it("removes day folders older than the retention window and nothing else", async () => {
    for (const name of ["2026-11-01", "2026-11-05", "2026-11-06", "2026-11-12", "keep-me"]) await mkdir(path.join(rawDir, name));

    const removed = await pruneRawPayloads(rawDir, 7, new Date("2026-11-12T10:00:00Z"));

    // Cut-off is 2026-11-05T10:00Z: a folder goes once its whole day is before that.
    expect(removed.sort()).toEqual(["2026-11-01"]);
    expect((await readdir(rawDir)).sort()).toEqual(["2026-11-05", "2026-11-06", "2026-11-12", "keep-me"]);
  });

  it("does nothing when the folder does not exist yet", async () => {
    await expect(pruneRawPayloads(path.join(rawDir, "missing"), 7, new Date())).resolves.toEqual([]);
  });
});
