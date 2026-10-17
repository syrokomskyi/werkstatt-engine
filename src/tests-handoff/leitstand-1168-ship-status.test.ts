/*
<MODULE_CONTRACT>
  <purpose>RFC-1168: leitstand.ship.status — journal resolution (site/mission), step-table render, running flag, missing-journal informational exit (AC-3, AC-4).</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1168: initial tests — journal resolve by mission/site, corrupt-line tolerance, resume-reset table, absent-journal exit 0.</item>
  <item>RFC-1168: ship stderr progress + leitstand.ship.status reader</item>
</CHANGE_SUMMARY>
*/

import { test, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type {
  KernelCommandInput,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { runLeitstandShipStatus, buildShipStatus, parseShipJournal } from "../leitstand/ship-status.ts";

const tmpRoots: string[] = [];

/** werkstatt/ + systems-cache/ siblings — mirrors the real layout. */
async function tmp(): Promise<string> {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "ship-status-"));
  const root = path.join(parent, "werkstatt");
  await fs.mkdir(root, { recursive: true });
  tmpRoots.push(parent);
  return root;
}

afterEach(async () => {
  while (tmpRoots.length > 0) {
    const d = tmpRoots.pop()!;
    await fs.rm(d, { recursive: true, force: true });
  }
});

const logger = {
  section() {},
  info() {},
  warn() {},
  error() {},
  success() {},
  getEvents() {
    return [];
  },
};

function ctx(root: string): KernelRuntimeContext {
  return {
    workspaceRoot: root,
    siteExplicit: false,
    logger,
    dryRun: false,
    outputFormat: "json",
    io: createDefaultIO().io,
  } as unknown as KernelRuntimeContext;
}

function input(flags: Record<string, unknown>): KernelCommandInput {
  return { argv: [], flags } as unknown as KernelCommandInput;
}

async function writeJournal(root: string, site: string, mission: string, records: string[]): Promise<string> {
  const dir = path.join(root, "..", "systems-cache", site, "operations");
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, `ship-${mission}.jsonl`);
  await fs.writeFile(p, records.join("\n") + "\n", "utf8");
  return p;
}

const rec = (kind: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ kind, opId: "op1", at: "2026-09-28T00:00:00.000Z", ...extra });

test("RFC-1168 AC-3: ship.status --mission renders the parsed step table", async () => {
  const root = await tmp();
  await writeJournal(root, "acme", "m1", [
    rec("op-started", { op: "leitstand.ship", missionId: "m1", platformVersion: "1.0.0" }),
    rec("step-started", { step: "mission.validate", seq: 0 }),
    rec("step-done", { step: "mission.validate", seq: 0 }),
    rec("step-started", { step: "mission.close", seq: 1 }),
    rec("step-done", { step: "mission.close", seq: 1 }),
    rec("op-done"),
  ]);
  const result = await runLeitstandShipStatus(
    input({ site: "acme", mission: "m1" }),
    ctx(root),
  );
  expect(result.exitCode).toBe(0);
  expect(result.data?.mission).toBe("m1");
  expect(result.data?.running).toBe(false);
  expect(result.data?.steps).toHaveLength(2);
  expect(result.data?.steps?.[0]?.name).toBe("mission.validate");
  expect(result.data?.steps?.[0]?.state).toBe("done");
});

test("RFC-1168: ship.status with in-flight journal reports running + per-step state", async () => {
  const root = await tmp();
  await writeJournal(root, "acme", "m2", [
    rec("op-started", { op: "leitstand.ship", missionId: "m2", platformVersion: "1.0.0" }),
    rec("step-started", { step: "mission.validate", seq: 0 }),
    rec("step-done", { step: "mission.validate", seq: 0 }),
    rec("step-started", { step: "mission.close", seq: 1 }),
  ]);
  const result = await runLeitstandShipStatus(
    input({ site: "acme", mission: "m2" }),
    ctx(root),
  );
  expect(result.exitCode).toBe(0);
  expect(result.data?.running).toBe(true);
  expect(result.data?.steps?.[1]?.state).toBe("running");
});

test("RFC-1168: corrupt journal lines are skipped and counted", async () => {
  const root = await tmp();
  await writeJournal(root, "acme", "m3", [
    rec("op-started", { op: "leitstand.ship", missionId: "m3" }),
    "{not-json",
    rec("step-started", { step: "a", seq: 0 }),
    rec("step-done", { step: "a", seq: 0 }),
    rec("op-done"),
    "{torn-tail",
  ]);
  const result = await runLeitstandShipStatus(
    input({ site: "acme", mission: "m3" }),
    ctx(root),
  );
  expect(result.exitCode).toBe(0);
  expect(result.data?.skippedLines).toBe(2);
  expect(result.data?.steps).toHaveLength(1);
});

test("RFC-1168: resume run resets the table at the second op-started", async () => {
  const content = [
    rec("op-started", { op: "leitstand.ship", missionId: "m4", opId: "opA" }),
    rec("step-done", { step: "old-step", seq: 0, opId: "opA" }),
    // second attempt — same journal
    rec("op-started", { op: "leitstand.ship", missionId: "m4", opId: "opB" }),
    rec("step-done", { step: "new-step", seq: 0, opId: "opB" }),
    rec("op-done", { opId: "opB" }),
  ].join("\n");
  const { records, skipped } = parseShipJournal(content);
  const status = buildShipStatus(records, "m4");
  expect(skipped).toBe(0);
  expect(status.steps).toHaveLength(1);
  expect(status.steps[0]?.name).toBe("new-step");
  expect(status.running).toBe(false);
});

test("RFC-1168 AC-4: missing journal exits 0 with running: false", async () => {
  const root = await tmp();
  await fs.mkdir(path.join(root, "..", "systems-cache", "acme"), { recursive: true });
  const result = await runLeitstandShipStatus(
    input({ site: "acme", mission: "ghost" }),
    ctx(root),
  );
  expect(result.exitCode).toBe(0);
  expect(result.data?.running).toBe(false);
  expect(result.data?.steps).toHaveLength(0);
});

test("RFC-1168: --site without --mission picks the newest ship journal by mtime", async () => {
  const root = await tmp();
  const p1 = await writeJournal(root, "acme", "old", [
    rec("op-started", { op: "leitstand.ship", missionId: "old" }),
    rec("op-done", {}),
  ]);
  // Make the second journal strictly newer on filesystems with coarse mtime.
  const past = new Date(Date.now() - 60_000);
  await fs.utimes(p1, past, past);
  await writeJournal(root, "acme", "new", [
    rec("op-started", { op: "leitstand.ship", missionId: "new" }),
    rec("step-started", { step: "x", seq: 0 }),
  ]);
  const result = await runLeitstandShipStatus(input({ site: "acme" }), ctx(root));
  expect(result.exitCode).toBe(0);
  expect(result.data?.mission).toBe("new");
  expect(result.data?.running).toBe(true);
});
