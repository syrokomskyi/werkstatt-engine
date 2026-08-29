/*
<MODULE_CONTRACT>
  <purpose>RFC-0962: leitstand.ship composite command handler tests — success, failure, resume, --until boundaries, self-healing.</purpose>
  <keywords>RFC-0962, leitstand, ship, composite, test, resume, journal</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0962: initial test suite for ship composite command.</item>
  <item>RFC-0962 fo-fix: added --until alt, --until main, invalid --until, releaseId restoration on resume tests; fixed resume test for stepResults including skipped steps.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { runLeitstandShip } from "../leitstand/ship.ts";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { assertNoUnknownFlags } from "./composite-phase-assert.ts";
import type {
  KernelRuntimeContext,
  KernelCommandInput,
  KernelFlagValue,
} from "@warpgogol/werkstatt-engine/kernel";

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelCommand: vi.fn(),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn(),
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

const mockExecSync = execSync as unknown as ReturnType<typeof vi.fn>;
const mockExecuteKernelCommand = executeKernelCommand as unknown as ReturnType<typeof vi.fn>;

const PHASE_FLAGS: Record<string, string[]> = {
  "leitstand.status": ["site", "system", "channel"],
  "agent.search.warm": ["site"],
  "mission.validate": [
    "mission",
    "skip-content-regression",
    "auto-accept-regression",
    "collect-errors",
  ],
  "mission.git.commit": ["mission", "message"],
  "mission.reconcile": ["mission", "message", "actor", "actor-from-auth"],
  "mission.close": [
    "mission",
    "actor",
    "actor-from-auth",
    "release",
    "skip-evidence-sync",
    "skip-auto-sync",
    "skip-content-regression",
    "skip-template-sync",
    "allow-no-op",
    "skip-reconcile-check",
  ],
  "release.prepare": ["mission", "semver"],
  "release.ready": ["release"],
  "leitstand.certify": [
    "site",
    "system",
    "gate",
    "release",
    "candidate-id",
    "artifact-hash",
    "base-url",
    "force",
  ],
  "leitstand.dev-deploy": ["site", "system", "release", "skip-evidence-sync", "force-build"],
  "leitstand.propagate": [
    "site",
    "system",
    "release",
    "gate-decision",
    "candidate-id",
    "artifact-hash",
  ],
  "leitstand.promote": [
    "site",
    "system",
    "release",
    "gate-decision",
    "main-verification-decision",
    "candidate-id",
    "artifact-hash",
  ],
  "leitstand.verify": [
    "site",
    "system",
    "channel",
    "compare-local",
    "timeout-ms",
    "verify-signature",
  ],
  "mission.archive": ["mission", "status"],
  "sternsystem.sync": ["id", "direction", "all"],
};

function assertAllPhaseCallsValid(): void {
  for (const call of mockExecuteKernelCommand.mock.calls) {
    const opts = call[0] as { commandName: string; argv: string[] };
    const allowed = PHASE_FLAGS[opts.commandName];
    if (allowed) {
      assertNoUnknownFlags(opts.argv, allowed, opts.commandName, "leitstand.ship");
    }
  }
}

const context = {
  workspaceRoot: "/tmp/test-ship",
  logger: { info: () => {}, success: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
} as unknown as KernelRuntimeContext;

function makeInput(flags: Record<string, KernelFlagValue>): KernelCommandInput {
  return { flags, argv: [] };
}

function mockPhaseResult(
  commandName: string,
  exitCode: number,
  data?: Record<string, unknown>,
): void {
  mockExecuteKernelCommand.mockImplementationOnce(async (_opts: { commandName: string }) => ({
    exitCode,
    data: data ?? {},
    summary: `[${commandName}] ${exitCode === 0 ? "ok" : "failed"}`,
  }));
}

let tmpDir: string;
let operationsDir: string;

beforeEach(async () => {
  mockExecuteKernelCommand.mockReset();
  mockExecSync.mockReset();
  mockExecSync.mockReturnValue("");

  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ship-test-"));
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

function setupFullSuccessMocks(releaseId: string = "test-sys-r000001"): void {
  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("mission.validate", 0);
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);
  mockPhaseResult("release.prepare", 0, { releaseId });
  mockPhaseResult("sternsystem.sync", 0);
  mockPhaseResult("release.ready", 0);
  mockPhaseResult("leitstand.certify", 0, { decisionId: "dec-dev" });
  mockPhaseResult("leitstand.dev-deploy", 0, { deploymentUrl: "https://dev.example.com" });
  mockPhaseResult("sternsystem.sync", 0);
  mockPhaseResult("leitstand.certify", 0, { decisionId: "dec-alt" });
  mockPhaseResult("leitstand.propagate", 0);
  mockPhaseResult("sternsystem.sync", 0);
  mockPhaseResult("leitstand.certify", 0, { decisionId: "dec-main" });
  mockPhaseResult("leitstand.promote", 0);
  mockPhaseResult("sternsystem.sync", 0);
  mockPhaseResult("leitstand.verify", 0);
}

test("full pipeline success — all 15 steps complete, exitCode 0", async () => {
  setupFullSuccessMocks();

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.completed).toBe(true);
  expect(result.data!.failedStep).toBeUndefined();
  expect(result.data!.releaseId).toBe("test-sys-r000001");
  expect(result.data!.steps.length).toBe(15);
  assertAllPhaseCallsValid();
});

test("--until validated stops after mission-validate (2 steps)", async () => {
  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("mission.validate", 0);

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "validated" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.completed).toBe(true);
  expect(result.data!.steps.length).toBe(2);
  expect(result.data!.reachedPhase).toBe("validated");
  assertAllPhaseCallsValid();
});

test("--until closed stops after mission-close (4 steps)", async () => {
  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("mission.validate", 0);
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "closed" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.completed).toBe(true);
  expect(result.data!.steps.length).toBe(4);
  expect(result.data!.reachedPhase).toBe("closed");
  assertAllPhaseCallsValid();
});

test("--until dev stops after certify-dev + dev-deploy + sync (9 steps)", async () => {
  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("mission.validate", 0);
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);
  mockPhaseResult("release.prepare", 0, { releaseId: "test-sys-r000002" });
  mockPhaseResult("sternsystem.sync", 0);
  mockPhaseResult("release.ready", 0);
  mockPhaseResult("leitstand.certify", 0, { decisionId: "dec-dev" });
  mockPhaseResult("leitstand.dev-deploy", 0, { deploymentUrl: "https://dev.example.com" });
  mockPhaseResult("sternsystem.sync", 0);

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "dev" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.completed).toBe(true);
  expect(result.data!.steps.length).toBe(9);
  expect(result.data!.reachedPhase).toBe("dev");
  assertAllPhaseCallsValid();
});

test("mission.validate fails — exitCode 1, failedStep set", async () => {
  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("mission.validate", 1);

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "validated" }),
    context,
  );

  expect(result.exitCode).toBe(1);
  expect(result.data!.completed).toBe(false);
  expect(result.data!.failedStep).toBe("mission-validate");
});

test("release.prepare fails — exitCode 1, pipeline stops before certify", async () => {
  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("mission.validate", 0);
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);
  mockPhaseResult("release.prepare", 1);

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "dev" }),
    context,
  );

  expect(result.exitCode).toBe(1);
  expect(result.data!.completed).toBe(false);
  expect(result.data!.failedStep).toBe("release-prepare");
});

test("certify-dev fails — exitCode 1, deploy not called", async () => {
  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("mission.validate", 0);
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);
  mockPhaseResult("release.prepare", 0, { releaseId: "test-sys-r000003" });
  mockPhaseResult("sternsystem.sync", 0);
  mockPhaseResult("release.ready", 0);
  mockPhaseResult("leitstand.certify", 1);

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "dev" }),
    context,
  );

  expect(result.exitCode).toBe(1);
  expect(result.data!.completed).toBe(false);
  expect(result.data!.failedStep).toBe("certify-dev");
});

test("self-healing: dirty workpiece after validate triggers auto-commit + re-validate", async () => {
  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("mission.validate", 0);
  mockExecSync.mockReturnValueOnce("M generated.ts\n");
  mockPhaseResult("mission.git.commit", 0);
  mockPhaseResult("mission.validate", 0);
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "closed" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  const validateCalls = mockExecuteKernelCommand.mock.calls.filter(
    (c) => (c[0] as { commandName: string }).commandName === "mission.validate",
  );
  expect(validateCalls.length).toBe(2);
  const commitCalls = mockExecuteKernelCommand.mock.calls.filter(
    (c) => (c[0] as { commandName: string }).commandName === "mission.git.commit",
  );
  expect(commitCalls.length).toBe(1);
  assertAllPhaseCallsValid();
});

test("resume after failure skips completed steps", async () => {
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

  const journalContent = await fs.readFile(journalPath, "utf-8");
  expect(journalContent).toContain("step-done");
  expect(journalContent).toContain("mission-validate");
  expect(journalContent).toContain("step-failed");

  vi.clearAllMocks();
  mockExecSync.mockReturnValue("");

  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);

  const result2 = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "closed", resume: true }),
    context,
  );

  expect(result2.exitCode).toBe(0);
  expect(result2.data!.completed).toBe(true);
  expect(result2.data!.steps.length).toBe(4);

  const reconcileCalls = mockExecuteKernelCommand.mock.calls.filter(
    (c) => (c[0] as { commandName: string }).commandName === "mission.reconcile",
  );
  expect(reconcileCalls.length).toBe(1);
  const validateCalls = mockExecuteKernelCommand.mock.calls.filter(
    (c) => (c[0] as { commandName: string }).commandName === "mission.validate",
  );
  expect(validateCalls.length).toBe(0);
});

test("resume with no incomplete operation returns success immediately", async () => {
  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", resume: true }),
    context,
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.completed).toBe(true);
  expect(mockExecuteKernelCommand).not.toHaveBeenCalled();
});

test("missing --site throws", async () => {
  await expect(runLeitstandShip(makeInput({ mission: "m000001" }), context)).rejects.toThrow(
    "--site is required",
  );
});

test("missing --mission throws", async () => {
  await expect(runLeitstandShip(makeInput({ site: "test-sys" }), context)).rejects.toThrow(
    "--mission is required",
  );
});

test("preflight: leitstand.status failure stops pipeline", async () => {
  mockPhaseResult("leitstand.status", 1);
  mockPhaseResult("agent.search.warm", 0);

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "validated" }),
    context,
  );

  expect(result.exitCode).toBe(1);
  expect(result.data!.completed).toBe(false);
  expect(result.data!.failedStep).toBe("preflight");
});

test("mission-archive step is non-fatal when mission.archive fails", async () => {
  setupFullSuccessMocks();
  mockPhaseResult("mission.archive", 1);

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.completed).toBe(true);
  expect(result.data!.steps.length).toBe(15);
});

test("--until alt stops after certify-alt + propagate + sync (11 steps)", async () => {
  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("mission.validate", 0);
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);
  mockPhaseResult("release.prepare", 0, { releaseId: "test-sys-r000010" });
  mockPhaseResult("sternsystem.sync", 0);
  mockPhaseResult("release.ready", 0);
  mockPhaseResult("leitstand.certify", 0, { decisionId: "dec-dev" });
  mockPhaseResult("leitstand.dev-deploy", 0, { deploymentUrl: "https://dev.example.com" });
  mockPhaseResult("sternsystem.sync", 0);
  mockPhaseResult("leitstand.certify", 0, { decisionId: "dec-alt" });
  mockPhaseResult("leitstand.propagate", 0);
  mockPhaseResult("sternsystem.sync", 0);

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "alt" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.completed).toBe(true);
  expect(result.data!.steps.length).toBe(11);
  expect(result.data!.reachedPhase).toBe("alt");
  assertAllPhaseCallsValid();
});

test("--until main stops after certify-main + promote + verify + sync (13 steps)", async () => {
  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("mission.validate", 0);
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);
  mockPhaseResult("release.prepare", 0, { releaseId: "test-sys-r000011" });
  mockPhaseResult("sternsystem.sync", 0);
  mockPhaseResult("release.ready", 0);
  mockPhaseResult("leitstand.certify", 0, { decisionId: "dec-dev" });
  mockPhaseResult("leitstand.dev-deploy", 0, { deploymentUrl: "https://dev.example.com" });
  mockPhaseResult("sternsystem.sync", 0);
  mockPhaseResult("leitstand.certify", 0, { decisionId: "dec-alt" });
  mockPhaseResult("leitstand.propagate", 0);
  mockPhaseResult("sternsystem.sync", 0);
  mockPhaseResult("leitstand.certify", 0, { decisionId: "dec-main" });
  mockPhaseResult("leitstand.promote", 0);
  mockPhaseResult("sternsystem.sync", 0);
  mockPhaseResult("leitstand.verify", 0);

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "main" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.completed).toBe(true);
  expect(result.data!.steps.length).toBe(13);
  expect(result.data!.reachedPhase).toBe("main");
  assertAllPhaseCallsValid();
});

test("invalid --until value throws", async () => {
  await expect(
    runLeitstandShip(makeInput({ site: "test-sys", mission: "m000001", until: "bogus" }), context),
  ).rejects.toThrow('invalid --until value "bogus"');
});

test("resume restores releaseId from journal after release-prepare completed", async () => {
  const journalPath = path.join(operationsDir, "ship-m000001.jsonl");

  // First run: succeeds through release-prepare, fails at release-ready
  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("mission.validate", 0);
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);
  mockPhaseResult("release.prepare", 0, { releaseId: "test-sys-r000099" });
  mockPhaseResult("sternsystem.sync", 0);
  mockPhaseResult("release.ready", 1);

  const result1 = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "dev" }),
    context,
  );
  expect(result1.exitCode).toBe(1);
  expect(result1.data!.failedStep).toBe("release-ready");
  expect(result1.data!.releaseId).toBe("test-sys-r000099");

  // Verify journal has releaseId in step-done meta
  const journalContent = await fs.readFile(journalPath, "utf-8");
  expect(journalContent).toContain("releaseId");

  vi.clearAllMocks();
  mockExecSync.mockReturnValue("");

  // Resume: release-ready + certify-dev + dev-deploy
  mockPhaseResult("release.ready", 0);
  mockPhaseResult("leitstand.certify", 0, { decisionId: "dec-dev" });
  mockPhaseResult("leitstand.dev-deploy", 0, { deploymentUrl: "https://dev.example.com" });

  const result2 = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "dev", resume: true }),
    context,
  );

  expect(result2.exitCode).toBe(0);
  expect(result2.data!.completed).toBe(true);
  expect(result2.data!.releaseId).toBe("test-sys-r000099");

  // Verify certify-dev was called with the restored releaseId
  const certifyCalls = mockExecuteKernelCommand.mock.calls.filter(
    (c) => (c[0] as { commandName: string }).commandName === "leitstand.certify",
  );
  expect(certifyCalls.length).toBe(1);
  const certifyArgv = (certifyCalls[0][0] as { argv: string[] }).argv;
  expect(certifyArgv.some((a) => a === "--release=test-sys-r000099")).toBe(true);
});
