/*
<MODULE_CONTRACT>
  <purpose>Test RFC-0958: property-based crash-at-every-seq resume matrix for runOperation.</purpose>
</MODULE_CONTRACT>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import fc from "fast-check";

import { runOperation, appendRecord } from "../runner.ts";
import type { OperationDefinition } from "../types.ts";

interface Ctx {
  effects: Set<string>;
}

function makeCtx(): Ctx {
  return { effects: new Set() };
}

function makeStep(name: string) {
  return {
    name,
    async run(c: Ctx) {
      c.effects.add(name);
    },
    verify: async (c: Ctx) => c.effects.has(name),
  };
}

function makeSteps(n: number): { steps: ReturnType<typeof makeStep>[]; ctx: Ctx } {
  const ctx = makeCtx();
  const steps = [];
  for (let i = 0; i < n; i++) {
    steps.push(makeStep(`s${i}`));
  }
  return { steps, ctx };
}

async function simulateCrashAtSeq(
  journalPath: string,
  opId: string,
  op: string,
  crashSeq: number,
  numSteps: number,
): Promise<void> {
  await appendRecord(journalPath, {
    kind: "op-started",
    opId,
    op,
    missionId: "m-pbt",
    at: new Date().toISOString(),
    platformVersion: "1.0.0",
  });
  for (let i = 0; i < crashSeq; i++) {
    await appendRecord(journalPath, {
      kind: "step-started",
      opId,
      step: `s${i}`,
      seq: i,
      at: new Date().toISOString(),
    });
    await appendRecord(journalPath, {
      kind: "step-done",
      opId,
      step: `s${i}`,
      seq: i,
      at: new Date().toISOString(),
    });
  }
  if (crashSeq < numSteps) {
    await appendRecord(journalPath, {
      kind: "step-started",
      opId,
      step: `s${crashSeq}`,
      seq: crashSeq,
      at: new Date().toISOString(),
    });
  }
}

let tmpDir: string;
let journalPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "journal-pbt-"));
  journalPath = path.join(tmpDir, "journal.jsonl");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("crash at every seq: resume completes with zero manual intervention", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 6 }), async (numSteps) => {
      for (let crashSeq = 0; crashSeq <= numSteps; crashSeq++) {
        rmSync(tmpDir, { recursive: true, force: true });
        const { steps: stepDefs, ctx } = makeSteps(numSteps);
        const def: OperationDefinition<Ctx> = { op: "test.pbt", steps: stepDefs };

        const opId = `pbt-crash-${numSteps}-${crashSeq}`;
        await simulateCrashAtSeq(journalPath, opId, "test.pbt", crashSeq, numSteps);

        const resumeResult = await runOperation(journalPath, def, ctx, { resumeOpId: opId });

        expect(
          resumeResult.completed,
          `crash at seq ${crashSeq} of ${numSteps} did not resume to completion`,
        ).toBe(true);
        const expectedExecuted = numSteps - crashSeq;
        expect(
          ctx.effects.size,
          `expected ${expectedExecuted} steps executed after resume from crash at seq ${crashSeq}`,
        ).toBe(expectedExecuted);
      }
    }),
    { numRuns: 5 },
  );
});

test("crash at random seq: resume completes all effects", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 2, max: 8 }),
      fc.integer({ min: 0, max: 8 }),
      async (numSteps, crashSeq) => {
        const actualCrash = Math.min(crashSeq, numSteps);
        rmSync(tmpDir, { recursive: true, force: true });
        const { steps: stepDefs, ctx } = makeSteps(numSteps);
        const def: OperationDefinition<Ctx> = { op: "test.pbt2", steps: stepDefs };

        const opId = `pbt-rand-${numSteps}-${actualCrash}`;
        await simulateCrashAtSeq(journalPath, opId, "test.pbt2", actualCrash, numSteps);

        const resumeResult = await runOperation(journalPath, def, ctx, { resumeOpId: opId });

        expect(resumeResult.completed, `crash at seq ${actualCrash} of ${numSteps}`).toBe(true);
        const expectedExecuted = numSteps - actualCrash;
        expect(ctx.effects.size).toBe(expectedExecuted);
      },
    ),
    { numRuns: 10 },
  );
});
