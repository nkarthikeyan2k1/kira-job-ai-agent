import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readProfileFile } from "./import.ts";

const EXAMPLE = new URL("../../config/profile.example.json", import.meta.url).pathname;

describe("readProfileFile", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "kira-profile-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const write = async (name: string, value: unknown) => {
    const file = path.join(dir, name);
    await writeFile(file, JSON.stringify(value));
    return file;
  };

  it("accepts the checked-in example", async () => {
    const profile = await readProfileFile(EXAMPLE);
    expect(profile.targetSeniority).toEqual(["mid", "senior"]);
  });

  it("rejects a misspelt key instead of silently ignoring it", async () => {
    const example = await readProfileFile(EXAMPLE);
    const file = await write("typo.json", { ...example, dealBreaker: ["night shift"] });
    await expect(readProfileFile(file)).rejects.toThrow(/dealBreaker/);
  });

  it("rejects an unknown seniority level", async () => {
    const example = await readProfileFile(EXAMPLE);
    const file = await write("level.json", { ...example, targetSeniority: ["expert"] });
    await expect(readProfileFile(file)).rejects.toThrow(/Invalid/);
  });

  it("explains what to do when the file is missing", async () => {
    await expect(readProfileFile(path.join(dir, "missing.json"))).rejects.toThrow(/profile\.example\.json/);
  });
});
