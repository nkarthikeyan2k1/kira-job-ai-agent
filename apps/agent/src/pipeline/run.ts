import type { Logger } from "pino";

export interface Stage<C extends { log: Logger }> {
  name: string;
  run(ctx: C): Promise<void>;
}

// Runs stages in order and stops at the first failure: later stages depend on
// earlier ones. (Per-source failures are handled inside the fetch stage.)
// Stages pass nothing to each other in memory: each reads its input from
// Postgres, so any stage can be re-run on its own.
export async function runPipeline<C extends { log: Logger }>(stages: readonly Stage<C>[], ctx: C): Promise<void> {
  for (const stage of stages) {
    const log = ctx.log.child({ stage: stage.name });
    const started = performance.now();
    log.info("stage started");
    await stage.run({ ...ctx, log });
    log.info({ ms: Math.round(performance.now() - started) }, "stage finished");
  }
}
