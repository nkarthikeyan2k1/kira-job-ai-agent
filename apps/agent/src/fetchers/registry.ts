import type { AtsType } from "@kira/shared";
import { greenhouseFetcher } from "./greenhouse.ts";
import { leverFetcher } from "./lever.ts";
import { peoplestrongFetcher } from "./peoplestrong.ts";
import type { Fetcher } from "./types.ts";

// ATS types without an entry (ashby, workday, scrape) are skipped with a warning.
export const FETCHERS: Partial<Record<AtsType, Fetcher>> = {
  greenhouse: greenhouseFetcher,
  lever: leverFetcher,
  peoplestrong: peoplestrongFetcher,
};
