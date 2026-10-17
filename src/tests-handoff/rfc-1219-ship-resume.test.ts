/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1219: leitstand.ship resume-after-failure — a failed ship leaves an
    op-interrupted journal that --resume picks up at the failed step, and a
    completed later op does not mask the interrupted one (warpgogol-m000192).
  </purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1219: initial tests — op-interrupted marker, resume at failed step, masking regression.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { runLeitstandShip } from "../leitstand/ship.ts";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type {
  KernelRuntimeContext,
  KernelCommandInput,
  KernelFlagValue,
} from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelCommand: vi.fn(),
  };
});

vi.mock("../kernel/runtime/registry-cache.ts", () => ({
  getOrBuildWorkspaceRegistry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@warpgogol/werkstatt-site/checks", () => ({
  ensureChromium: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../sternsystem/registry-io.ts", () => ({
  resolveCacheClonePath: vi.fn((workspaceRoot: string, systemId: string) =>
    path.join(workspaceRoot, "systems-cache", systemId),
  ),
}));

const mockIoExec = vi.fn();
const mockExecuteKernelCommand = executeKernelCommand as unknown as ReturnType<typeof vi.fn>;

const context = {
  io: { ...createDefaultIO().io, exec: mockIoExec },
  workspaceRoot: "/tmp/test-ship",
  logger: { info: () => {}, success: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
} as unknown as KernelRuntimeContext;

function makeInput(flags: Record<string, KernelFlagValue>): KernelCommandInput {
  return { flags, argv: [] };
}

function mockPhaseResult(commandName: string, exitCode: number): void {
  mockExecuteKernelCommand.mockImplementationOnce(async (_opts: { commandName: string }) => ({
    exitCode,
    data: {},
    summary: `[${commandName}] ${exitCode === 0 ? "ok" : "failed"}`,
  }));
}

let tmpDir: string;
let operationsDir: string;

beforeEach(async () => {
  mockExecuteKernelCommand.mockReset();
  mockIoExec.mockReset();
  mockIoExec.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ship-1219-"));
  operationsDir = path.join(tmpDir, "systems-cache", "test-sys", "operations");
  await fs.mkdir(operationsDir, { recursive: true });

  const envPath = path.join(tmpDir, "missions", "m000001", "workpiece", ".env");
  await fs.mkdir(path.dirname(envPath), { recursive: true });
  await fs.writeFile(envPath, "TEST=1\n");

  (context as unknown as { workspaceRoot: string }).workspaceRoot = tmpDir;
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// AC-1/AC-2: a failed ship leaves the journal open with an op-interrupted
// marker naming the failed step; --resume re-executes the failed step and
// skips completed ones.
test("RFC-1219 AC-1/AC-2: failed ship journals op-interrupted and --resume continues at the failed step", async () => {
  const journalPath = path.join(operationsDir, "ship-m000001.jsonl");

  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("mission.validate", 0);
  mockPhaseResult("mission.reconcile", 1);

  const result1 = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "closed" }),
    context,
  );
  expect(result1.exitCode).toBe(1);
  expect(result1.data!.failedStep).toBe("mission-reconcile");

  // AC-2: journal stays open with an explicit interrupted marker naming the
  // failed step — no op-done for this op.
  const journalContent = await fs.readFile(journalPath, "utf-8");
  expect(journalContent).toContain('"kind":"op-interrupted"');
  expect(journalContent).toContain('"failedStep":"mission-reconcile"');
  expect(journalContent).not.toContain('"kind":"op-done"');

  vi.clearAllMocks();
  mockIoExec.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

  // AC-1: --resume reports the failed step and re-executes it — completed
  // steps are skipped, mission.reconcile is invoked exactly once.
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);

  const result2 = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "closed", resume: true }),
    context,
  );

  expect(result2.exitCode).toBe(0);
  expect(result2.data!.completed).toBe(true);
  const invoked = mockExecuteKernelCommand.mock.calls.map(
    (c) => (c[0] as { commandName: string }).commandName,
  );
  expect(invoked.filter((n) => n === "mission.reconcile")).toHaveLength(1);
  expect(invoked).not.toContain("mission.validate");
  expect(invoked).not.toContain("leitstand.status");
});

// AC-6: a completed later op must not mask an earlier interrupted ship op —
// findIncompleteOperation scans all op-started newest-first.
test("RFC-1219 AC-6: a completed later op does not mask an earlier interrupted ship op", async () => {
  const journalPath = path.join(operationsDir, "ship-m000001.jsonl");
  await fs.writeFile(
    journalPath,
    [
      '{"kind":"op-started","opId":"ship-old","op":"leitstand.ship","missionId":"m000001","at":"t0","platformVersion":"1"}',
      '{"kind":"step-started","opId":"ship-old","step":"preflight","seq":0,"at":"t1"}',
      '{"kind":"step-failed","opId":"ship-old","step":"preflight","seq":0,"at":"t2","error":"boom"}',
      '{"kind":"op-interrupted","opId":"ship-old","at":"t3","failedStep":"preflight"}',
      // A later op that ran to completion — previously masked ship-old.
      '{"kind":"op-started","opId":"ship-new","op":"leitstand.ship","missionId":"m000001","at":"t4","platformVersion":"1"}',
      '{"kind":"step-started","opId":"ship-new","step":"preflight","seq":0,"at":"t5"}',
      '{"kind":"step-done","opId":"ship-new","step":"preflight","seq":0,"at":"t6"}',
      '{"kind":"op-done","opId":"ship-new","at":"t7"}',
      "",
    ].join("\n"),
  );

  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("mission.validate", 0);
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "closed", resume: true }),
    context,
  );

  // The earlier interrupted op is found and resumed from preflight — not
  // reported as "nothing to resume".
  expect(result.exitCode).toBe(0);
  expect(result.data!.completed).toBe(true);
  const invoked = mockExecuteKernelCommand.mock.calls.map(
    (c) => (c[0] as { commandName: string }).commandName,
  );
  expect(invoked).toContain("leitstand.status");
});
