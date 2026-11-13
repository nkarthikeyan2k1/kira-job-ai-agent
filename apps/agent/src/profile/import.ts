import { readFile } from "node:fs/promises";
import { ProfileInputSchema, type ProfileInput } from "@kira/shared";
import type pg from "pg";
import { z } from "zod";
import { saveProfile } from "../db/profile-repo.ts";

/** Reads and validates a profile.json; throws with a readable message when it is missing or wrong. */
export async function readProfileFile(file: string): Promise<ProfileInput> {
  const raw = await readFile(file, "utf8").catch(() => {
    throw new Error(`${file} not found: copy apps/agent/config/profile.example.json there and fill it in`);
  });
  const parsed = ProfileInputSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`Invalid ${file}:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export async function importProfile(db: pg.Pool, file: string): Promise<ProfileInput> {
  const profile = await readProfileFile(file);
  await saveProfile(db, profile);
  return profile;
}
