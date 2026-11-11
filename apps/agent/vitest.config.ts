import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Tests read the root .env only for TEST_DATABASE_URL (integration tests).
const rootEnv = new URL("../../.env", import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
