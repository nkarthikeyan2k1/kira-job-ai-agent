import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Secrets live in the repo-root .env (shared with the agent); Next only reads
// .env files from apps/web, so load the root one before anything else runs.
const rootEnv = path.resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // @kira/shared ships TypeScript source, so Next compiles it.
  transpilePackages: ["@kira/shared"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
