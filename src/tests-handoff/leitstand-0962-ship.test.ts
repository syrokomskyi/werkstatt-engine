/*
<MODULE_CONTRACT>
  <purpose>RFC-0962: leitstand.ship composite command handler tests — success, failure, resume, --until boundaries, self-healing.</purpose>
  <keywords>RFC-0962, leitstand, ship, composite, test, resume, journal</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0962 fo-fix: added --until alt, --until main, invalid --until, releaseId restoration on resume tests; fixed resume test for stepResults including skipped steps.</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
  <item>RFC-1190: step-count updates for the 18-step plan (evidence-sync-* after each certify-*); mission + skip-evidence-sync added to deploy PHASE_FLAGS; evidence.sync flag table entry.</item>
  <item>RFC-1190: restore mission context + evidence archival in release-mode deploys

RFC-1190: precedence-ordered resolveMissionContext (--mission → release build-identity → currentMission), MISSION_CONTEXT_UNRESOLVED/MISMATCH blocking, fail-closed EVIDENCE_SYNC_FAILED with --skip-evidence-sync as sole escape hatch, journaled evidence-sync-* ship steps after each certify-*, evidence.sync --site/--system flag.

2026-10-04 handoff fixes: shared 25min mission.check timeout (inner 5min race + 300s orchestrator raced cold ~7-11min captures), sweep excludeOpIds so mission.close no longer self-abandons the live ship journal (broke --resume), name-keyed journal resume state so closed-mission plan shifts can't skip unexecuted steps, wrangler dev documented as the required --base-url preview server.</item>
  <item>RFC-1207: candidate-preview certify — wrangler dev on releases/<id>/dist/server measures the candidate artifact</item>
  <history>RFC-0962</history>
</CHANGE_SUMMARY>
*/

import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { runLeitstandShip } from "../leitstand/ship.ts";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { assertNoUnknownFlags } from "./composite-phase-assert.ts";
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
function ioExecOk(stdout: string): void {
  mockIoExec.mockResolvedValue({ exitCode: 0, stdout, stderr: "" });
}
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
    "target",
    "force",
    "auto-manage-pin",
  ],
  "leitstand.dev-deploy": [
    "site",
    "system",
    "release",
    "mission",
    "skip-evidence-sync",
    "force-build",
  ],
  "leitstand.propagate": [
    "site",
    "system",
    "release",
    "mission",
    "skip-evidence-sync",
    "gate-decision",
    "candidate-id",
    "artifact-hash",
  ],
  "leitstand.promote": [
    "site",
    "system",
    "release",
    "mission",
    "skip-evidence-sync",
    "gate-decision",
    "main-verification-decision",
    "candidate-id",
    "artifact-hash",
  ],
  "evidence.sync": ["mission", "site", "system", "run-timestamp", "dry-run", "json"],
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
  io: { ...createDefaultIO().io, exec: mockIoExec },
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
  mockIoExec.mockReset();
  ioExecOk("");

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

test("full pipeline success — all 18 steps complete, exitCode 0", async () => {
  setupFullSuccessMocks();

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.completed).toBe(true);
  expect(result.data!.failedStep).toBeUndefined();
  expect(result.data!.releaseId).toBe("test-sys-r000001");
  expect(result.data!.steps.length).toBe(18);
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

test("--until dev stops after certify-dev + dev-deploy + evidence-sync + sync (10 steps)", async () => {
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
  expect(result.data!.steps.length).toBe(10);
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
  // RFC-1217's gate consumes io.exec calls before mission-validate — dispatch on
  // args so the dirty-status stub lands on `git status` regardless of ordering.
  mockIoExec.mockImplementation(async (_cmd: string, args: string[]) => ({
    exitCode: 0,
    stdout: args.join(" ") === "status --porcelain" ? "M generated.ts\n" : "",
    stderr: "",
  }));
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

test("RFC-1207 AC-6: certify step-done journal record carries candidatePreview.artifactHash", async () => {
  const journalPath = path.join(operationsDir, "ship-m000001.jsonl");
  const artifactHash = `sha256:${"b".repeat(64)}`;

  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("mission.validate", 0);
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);
  mockPhaseResult("release.prepare", 0, { releaseId: "test-sys-r000004" });
  mockPhaseResult("sternsystem.sync", 0);
  mockPhaseResult("release.ready", 0);
  mockPhaseResult("leitstand.certify", 0, {
    decisionId: "dec-dev",
    preview: {
      artifactHash,
      baseUrl: "http://127.0.0.1:59999",
      port: 59999,
    },
  });
  mockPhaseResult("leitstand.dev-deploy", 0, { deploymentUrl: "https://dev.example.com" });
  mockPhaseResult("sternsystem.sync", 0);

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "dev" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  const journalContent = await fs.readFile(journalPath, "utf-8");
  const certifyDone = journalContent
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(
      (line) =>
        JSON.parse(line) as { kind?: string; step?: string; meta?: Record<string, unknown> },
    )
    .find((rec) => rec.kind === "step-done" && rec.step === "certify-dev");
  expect(certifyDone).toBeDefined();
  const candidatePreview = certifyDone!.meta?.candidatePreview as
    { artifactHash?: string; baseUrl?: string } | undefined;
  expect(candidatePreview?.artifactHash).toBe(artifactHash);
  expect(candidatePreview?.baseUrl).toBe("http://127.0.0.1:59999");
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
  ioExecOk("");

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
  expect(result.data!.steps.length).toBe(18);
});

test("epilogue sync sweeps journal tail after op-done (runs last)", async () => {
  setupFullSuccessMocks();
  mockPhaseResult("mission.archive", 0);
  mockPhaseResult("sternsystem.sync", 0);

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  const callNames = mockExecuteKernelCommand.mock.calls.map(
    (c) => (c[0] as { commandName: string }).commandName,
  );
  expect(callNames.filter((n) => n === "sternsystem.sync").length).toBe(5);
  expect(callNames[callNames.length - 1]).toBe("sternsystem.sync");
});

test("epilogue sync failure is non-fatal — ship result unaffected", async () => {
  setupFullSuccessMocks();
  mockPhaseResult("mission.archive", 0);
  mockPhaseResult("sternsystem.sync", 1); // epilogue fails

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.completed).toBe(true);
  expect(result.data!.releaseId).toBe("test-sys-r000001");
});

test("epilogue sync also sweeps after a failed op (journal reaches mirrors for --resume)", async () => {
  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("mission.validate", 1);
  mockPhaseResult("sternsystem.sync", 0); // epilogue still runs

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "validated" }),
    context,
  );

  expect(result.exitCode).toBe(1);
  expect(result.data!.failedStep).toBe("mission-validate");
  const syncCalls = mockExecuteKernelCommand.mock.calls.filter(
    (c) => (c[0] as { commandName: string }).commandName === "sternsystem.sync",
  );
  expect(syncCalls.length).toBe(1);
});

test("--until alt stops after certify-alt + propagate + evidence-sync + sync (13 steps)", async () => {
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
  expect(result.data!.steps.length).toBe(13);
  expect(result.data!.reachedPhase).toBe("alt");
  assertAllPhaseCallsValid();
});

test("--until main stops after certify-main + promote + evidence-sync + sync (16 steps)", async () => {
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
  expect(result.data!.steps.length).toBe(16);
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
  ioExecOk("");

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

test("closed mission + --until alt stops at sync-after-alt — promote never runs", async () => {
  // PHASE_STEP_COUNT is indexed against the full 15-step plan; when lifecycle
  // steps are filtered out for a closed mission, the slice must happen BEFORE
  // the filter — otherwise --until alt overshoots into certify-main.
  await fs.writeFile(path.join(tmpDir, "missions", "m000001", "mission.yaml"), "state: closed\n");

  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("release.prepare", 0, { releaseId: "test-sys-r000050" });
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
  // preflight, release-prepare, sync, release-ready, certify-dev,
  // evidence-sync-dev, sync, certify-alt, evidence-sync-alt, sync — 10 steps;
  // certify-main/promote must not be in the plan.
  expect(result.data!.steps.length).toBe(10);
  expect(result.data!.reachedPhase).toBe("alt");
  const invokedCommands = mockExecuteKernelCommand.mock.calls.map(
    (c) => (c[0] as { commandName: string }).commandName,
  );
  expect(invokedCommands).not.toContain("leitstand.promote");
  expect(invokedCommands).not.toContain("mission.validate");
  assertAllPhaseCallsValid();
});

test("archived closed mission — resolves archive path, skips lifecycle, .env from cache clone", async () => {
  // Deferred-release layout: mission archived to missions/archive/closed/ and
  // .env persisted to the cache clone by mission.close (RFC-0822). ship must
  // resolve the archived workpiece and accept the cache-clone .env.
  const src = path.join(tmpDir, "missions", "m000001");
  const dst = path.join(tmpDir, "missions", "archive", "closed", "m000001");
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.rename(src, dst);
  await fs.writeFile(path.join(dst, "mission.yaml"), "state: closed\n");
  await fs.rm(path.join(dst, "workpiece", ".env"));
  await fs.writeFile(path.join(tmpDir, "systems-cache", "test-sys", ".env"), "TEST=1\n");

  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("release.prepare", 0, { releaseId: "test-sys-r000060" });
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
  // preflight, release-prepare, sync, release-ready, certify-dev, dev-deploy — 6
  const invokedCommands = mockExecuteKernelCommand.mock.calls.map(
    (c) => (c[0] as { commandName: string }).commandName,
  );
  expect(invokedCommands).toContain("release.prepare");
  expect(invokedCommands).not.toContain("mission.validate");
  expect(invokedCommands).not.toContain("mission.reconcile");
  expect(invokedCommands).not.toContain("mission.close");
  assertAllPhaseCallsValid();
});

test("mission not found — clear error instead of misleading .env failure", async () => {
  await fs.rm(path.join(tmpDir, "missions", "m000001"), { recursive: true, force: true });

  await expect(
    runLeitstandShip(makeInput({ site: "test-sys", mission: "m000001" }), context),
  ).rejects.toThrow("mission m000001 not found");
});

// ─── RFC-1217: unreconciled-workpiece preflight gate ─────────────────────────
//
// The gate resolves the workpiece branch, fetches it into the cache clone, and
// counts HEAD..FETCH_HEAD — the exact range fetch-and-merge would pull. All
// git goes through the mocked ctx.io.exec; dispatch on args to script the
// sequence. Any unhandled call returns the default ok/"" (which itself drives
// the warn-skip path — empty branch output => indeterminate).

type ExecOut = { exitCode: number; stdout: string; stderr: string };
function stubGateExec(opts: { count: string; oneline?: string; fetchFails?: boolean }): void {
  mockIoExec.mockImplementation(
    async (_cmd: string, args: string[], o?: { cwd?: string }): Promise<ExecOut> => {
      const key = args.join(" ");
      if (key === "rev-parse --abbrev-ref HEAD") {
        return { exitCode: 0, stdout: "main\n", stderr: "" };
      }
      if (key.startsWith("fetch ") && o?.cwd?.includes("systems-cache")) {
        return opts.fetchFails
          ? { exitCode: 1, stdout: "", stderr: "fetch exploded" }
          : { exitCode: 0, stdout: "", stderr: "" };
      }
      if (key === "rev-list HEAD..FETCH_HEAD --count") {
        return { exitCode: 0, stdout: `${opts.count}\n`, stderr: "" };
      }
      if (key === "rev-list HEAD..FETCH_HEAD --oneline") {
        return { exitCode: 0, stdout: opts.oneline ?? "", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  );
}

test("RFC-1217 AC-1+AC-4: unreconciled workpiece commits block at preflight before mission.validate", async () => {
  stubGateExec({ count: "2", oneline: "fba300a1 regenerate docs\n641165e8 touch readme" });
  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "closed" }),
    context,
  );

  expect(result.exitCode).toBe(1);
  expect(result.data!.completed).toBe(false);
  expect(result.data!.failedStep).toBe("preflight");
  expect(result.summary).toContain("unreconciled workpiece commit");
  expect(result.summary).toContain("mission.reconcile");
  // AC-4: mission.validate never ran — the gate fired before any real work.
  const invoked = mockExecuteKernelCommand.mock.calls.map(
    (c) => (c[0] as { commandName: string }).commandName,
  );
  expect(invoked).not.toContain("mission.validate");
});

test("RFC-1217 AC-2: fully merged workpiece — gate passes, ship proceeds to mission-validate", async () => {
  stubGateExec({ count: "0" });
  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("mission.validate", 0);

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "validated" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.completed).toBe(true);
  const invoked = mockExecuteKernelCommand.mock.calls.map(
    (c) => (c[0] as { commandName: string }).commandName,
  );
  expect(invoked).toContain("mission.validate");
});

test("RFC-1217 AC-3: --allow-unreconciled degrades the gate to a warning", async () => {
  stubGateExec({ count: "3", oneline: "abc1234 x\ndef5678 y\naaa9999 z" });
  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("mission.validate", 0);

  const result = await runLeitstandShip(
    makeInput({
      site: "test-sys",
      mission: "m000001",
      until: "validated",
      "allow-unreconciled": true,
    }),
    context,
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.completed).toBe(true);
  const invoked = mockExecuteKernelCommand.mock.calls.map(
    (c) => (c[0] as { commandName: string }).commandName,
  );
  expect(invoked).toContain("mission.validate");
});

test("RFC-1217 AC-5: closed mission skips the gate entirely — no workpiece fetch", async () => {
  await fs.writeFile(path.join(tmpDir, "missions", "m000001", "mission.yaml"), "state: closed\n");
  stubGateExec({ count: "9" }); // would block if the gate ran
  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "closed" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.completed).toBe(true);
  const fetchCalls = mockIoExec.mock.calls.filter(
    (c) => Array.isArray(c[1]) && (c[1] as string[])[0] === "fetch",
  );
  expect(fetchCalls.length).toBe(0);
});

test("RFC-1217 degrade: git unreadable (fetch fails) warns but does not block", async () => {
  stubGateExec({ count: "0", fetchFails: true });
  mockPhaseResult("leitstand.status", 0);
  mockPhaseResult("agent.search.warm", 0);
  mockPhaseResult("mission.validate", 0);

  const result = await runLeitstandShip(
    makeInput({ site: "test-sys", mission: "m000001", until: "validated" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  const invoked = mockExecuteKernelCommand.mock.calls.map(
    (c) => (c[0] as { commandName: string }).commandName,
  );
  expect(invoked).toContain("mission.validate");
});
