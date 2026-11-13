import { pino } from "pino";
import { PATHS } from "../../config/paths.ts";
import { createPool } from "../db/client.ts";
import { loadEnv } from "../env.ts";
import { importProfile } from "./import.ts";

// `npm run profile:import`: loads apps/agent/data/profile.json into the single profile row.
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL });
const db = createPool(env.DATABASE_URL);

try {
  const profile = await importProfile(db, PATHS.profileJson);
  // Counts only: the values themselves are personal and stay out of the logs.
  log.info(
    {
      targetRoles: profile.targetRoles.length,
      titleKeywords: profile.titleKeywordsInclude.length + profile.titleKeywordsExclude.length,
      locations: profile.locations.length,
    },
    "profile imported; run `npm run filter:report -- --refilter` to apply it to unscored jobs",
  );
} catch (err) {
  log.fatal({ err }, "profile import failed");
  process.exitCode = 1;
} finally {
  await db.end();
}
