/*
<MODULE_CONTRACT>
  <purpose>RFC-1168: leitstand.ship stderr progress — onTransition seam in runOperation, step-line format, preamble hints (AC-1, AC-2).</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1168: initial tests — onTransition record stream, formatShipTransition line shapes, shipPreambleLines journal/watch hints.</item>
  <item>RFC-1168: ship stderr progress + leitstand.ship.status reader</item>
</CHANGE_SUMMARY>
*/

import { test, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runOperation } from "../journal/index.ts";
import type { JournalRecord, OperationDefinition } from "../journal/index.ts";
import { formatShipTransition, shipPreambleLines } from "../leitstand/ship.ts";

const tmpDirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ship-progress-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const d = tmpDirs.pop()!;
    await fs.rm(d, { recursive: true, force: true });
  }
});

function twoStepOp(): OperationDefinition<Record<string, never>> {
  return {
    op: "leitstand.ship",
    steps: [
      { name: "mission.validate", run: async () => ({}) },
      { name: "mission.close", run: async () => ({}) },
    ],
  };
}

test("RFC-1168 AC-1: onTransition receives one record per journal transition, in order", async () => {
  const dir = await tmp();
  const journal = path.join(dir, "ship-test.jsonl");
  const seen: JournalRecord[] = [];
  await runOperation(
    journal,
    twoStepOp(),
    {},
    {
      missionId: "m1",
      platformVersion: "1.0.0",
      onTransition: (r) => seen.push(r),
    },
  );
  const kinds = seen.map((r) => r.kind);
  expect(kinds).toEqual([
    "op-started",
    "step-started",
    "step-done",
    "step-started",
    "step-done",
    "op-done",
  ]);
  // And every line formats into the documented [ship] shape.
  const lines = seen.map((r) => formatShipTransition(r, 2));
  expect(lines[1]).toBe("[ship] step 1/2: mission.validate — running");
  expect(lines[2]).toBe("[ship] step 1/2: mission.validate — done");
  // With a tracked start time the same record carries the (Ns) suffix.
  expect(formatShipTransition(seen[2], 2, 94_000)).toBe(
    "[ship] step 1/2: mission.validate — done (94s)",
  );
  expect(lines[5]).toBe("[ship] done");
});

test("RFC-1168: failing step emits step-failed line with error, no op-done", async () => {
  const dir = await tmp();
  const journal = path.join(dir, "ship-test.jsonl");
  const seen: JournalRecord[] = [];
  const def: OperationDefinition<Record<string, never>> = {
    op: "leitstand.ship",
    steps: [
      { name: "ok-step", run: async () => ({}) },
      {
        name: "bad-step",
        run: async () => {
          throw new Error("boom");
        },
      },
      { name: "never", run: async () => ({}) },
    ],
  };
  await runOperation(
    journal,
    def,
    {},
    {
      missionId: "m1",
      platformVersion: "",
      onTransition: (r) => seen.push(r),
    },
  );
  const kinds = seen.map((r) => r.kind);
  // RFC-1219: step-failed is followed by the non-terminal op-interrupted
  // marker — still no op-done.
  expect(kinds[kinds.length - 2]).toBe("step-failed");
  expect(kinds[kinds.length - 1]).toBe("op-interrupted");
  expect(kinds).not.toContain("op-done");
  const line = formatShipTransition(seen[seen.length - 2], 3);
  expect(line).toMatch(/^\[ship\] step 2\/3: bad-step — failed — boom/);
  expect(formatShipTransition(seen[seen.length - 1], 3)).toBe(
    '[ship] interrupted at step "bad-step" — run with --resume',
  );
});

test("RFC-1168 AC-2: preamble lines name journal path and the ship.status watch invocation", async () => {
  const lines = shipPreambleLines("/x/systems-cache/acme/operations/ship-m1.jsonl", "acme", "m1");
  expect(lines[0]).toContain("journal: /x/systems-cache/acme/operations/ship-m1.jsonl");
  expect(lines[1]).toContain("leitstand.ship.status --site acme --mission m1 --follow");
});

test("RFC-1168: onTransition is optional — runner works unchanged without it", async () => {
  const dir = await tmp();
  const journal = path.join(dir, "ship-test.jsonl");
  const result = await runOperation(
    journal,
    twoStepOp(),
    {},
    {
      missionId: "m1",
      platformVersion: "",
    },
  );
  expect(result.completed).toBe(true);
  expect(result.executed).toEqual(["mission.validate", "mission.close"]);
});

test("RFC-1168: a throwing onTransition never breaks the operation", async () => {
  const dir = await tmp();
  const journal = path.join(dir, "ship-test.jsonl");
  const result = await runOperation(
    journal,
    twoStepOp(),
    {},
    {
      missionId: "m1",
      platformVersion: "",
      onTransition: () => {
        throw new Error("closed pipe");
      },
    },
  );
  expect(result.completed).toBe(true);
});
