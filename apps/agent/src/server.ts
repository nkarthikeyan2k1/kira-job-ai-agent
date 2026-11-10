import { buildApp } from "./app.ts";
import { createPool } from "./db/client.ts";
import { loadEnv } from "./env.ts";
import { dbCheck, ollamaCheck } from "./health.ts";

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);

const app = buildApp(
  { healthChecks: { db: dbCheck(pool), ollama: ollamaCheck(env.OLLAMA_URL) } },
  { logger: { level: env.LOG_LEVEL } },
);
app.addHook("onClose", async () => {
  await pool.end();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "shutting down");
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
