import type { Logger } from "pino";

export interface StageContext {
  log: Logger;
}

export interface Stage {
  name: string;
  run(ctx: StageContext): Promise<void>;
}

// Runs stages in order and stops at the first failure: later stages depend on
// earlier ones. (Per-source failures are handled inside the fetch stage.)
export async function runPipeline(stages: readonly Stage[], log: Logger): Promise<void> {
  for (const stage of stages) {
    const stageLog = log.child({ stage: stage.name });
    const started = performance.now();
    stageLog.info("stage started");
    await stage.run({ log: stageLog });
    stageLog.info({ ms: Math.round(performance.now() - started) }, "stage finished");
  }
}
