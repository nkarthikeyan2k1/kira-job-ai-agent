import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { runPipeline, type Stage } from "./run.ts";

const log = pino({ level: "silent" });

function recorder(name: string, calls: string[], fail = false): Stage<{ log: typeof log }> {
  return {
    name,
    async run() {
      calls.push(name);
      if (fail) throw new Error(`${name} failed`);
    },
  };
}

describe("runPipeline", () => {
  it("runs stages in order", async () => {
    const calls: string[] = [];
    await runPipeline([recorder("a", calls), recorder("b", calls), recorder("c", calls)], { log });
    expect(calls).toEqual(["a", "b", "c"]);
  });

  it("stops at the first failing stage", async () => {
    const calls: string[] = [];
    const stages = [recorder("a", calls), recorder("b", calls, true), recorder("c", calls)];

    await expect(runPipeline(stages, { log })).rejects.toThrow("b failed");
    expect(calls).toEqual(["a", "b"]);
  });
});
