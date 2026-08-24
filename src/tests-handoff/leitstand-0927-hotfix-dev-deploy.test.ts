/*
<MODULE_CONTRACT>
  <purpose>RFC-0927: leitstand.hotfix.dev-deploy composite command handler tests — phase skipping, fallback, failure modes.</purpose>
  <keywords>RFC-0927, leitstand, hotfix, dev-deploy, composite, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0927: initial test suite for hotfix composite command.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, vi, beforeEach } from "vitest";
import { runLeitstandHotfixDevDeploy } from "../leitstand/leitstand-commands.ts";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";
import { execSync } from "node:child_process";
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

const mockExecSync = execSync as unknown as ReturnType<typeof vi.fn>;
const mockExecuteKernelCommand = executeKernelCommand as unknown as ReturnType<typeof vi.fn>;

// Command-specific flags (excluding KERNEL_UNIVERSAL_FLAGS) for each sub-command
// called by leitstand.hotfix.dev-deploy. Sourced from module registrations.
const PHASE_FLAGS: Record<string, string[]> = {
  "mission.git.commit": ["mission", "message"],
  "validate.postbuild": ["mission", "site", "skip-slow"],
  "mission.validate": [
    "mission",
    "skip-content-regression",
    "auto-accept-regression",
    "collect-errors",
    "force-build",
  ],
  "mission.reconcile": ["mission", "message", "actor", "actor-from-auth"],
  "mission.close": [
    "mission",
    "actor",
    "actor-from-auth",
    "release",
    "skip-evidence-sync",
    "skip-auto-sync",
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
};

function assertAllPhaseCallsValid(): void {
  for (const call of mockExecuteKernelCommand.mock.calls) {
    const opts = call[0] as { commandName: string; argv: string[] };
    const allowed = PHASE_FLAGS[opts.commandName];
    if (allowed) {
      assertNoUnknownFlags(opts.argv, allowed, opts.commandName, "leitstand.hotfix.dev-deploy");
    }
  }
}

const context = {
  workspaceRoot: "/tmp/test-hotfix",
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

beforeEach(() => {
  vi.clearAllMocks();
  mockExecSync.mockReturnValue("");
});

test("all phases succeed — returns deploymentUrl, no failingPhase", async () => {
  mockExecSync.mockReturnValueOnce("M file.ts\n"); // git status --porcelain (dirty)
  mockPhaseResult("mission.git.commit", 0);
  mockExecSync.mockReturnValueOnce("abc123\n"); // git rev-parse HEAD after commit
  mockPhaseResult("validate.postbuild", 0);
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);
  mockPhaseResult("release.prepare", 0, { releaseId: "test-sys-r000001" });
  mockPhaseResult("release.ready", 0);
  mockPhaseResult("leitstand.certify", 0, { decisionId: "dec-001" });
  mockPhaseResult("leitstand.dev-deploy", 0, { deploymentUrl: "https://dev.example.com" });

  const result = await runLeitstandHotfixDevDeploy(
    makeInput({ site: "test-sys", mission: "m000001" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.failingPhase).toBeUndefined();
  expect(result.data!.deploymentUrl).toBe("https://dev.example.com");
  expect(result.data!.phases.commit.skipped).toBe(false);
  expect(result.data!.phases.commit.commitSha).toBe("abc123");
  expect(result.data!.phases.validate.mode).toBe("postbuild");
  expect(result.data!.phases.validate.passed).toBe(true);
  expect(result.data!.phases.deploy.deployed).toBe(true);
  assertAllPhaseCallsValid();
});

test("workpiece clean — phase 1 skipped, pipeline continues", async () => {
  mockExecSync.mockReturnValue(""); // clean workpiece
  mockPhaseResult("validate.postbuild", 0);
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);
  mockPhaseResult("release.prepare", 0, { releaseId: "test-sys-r000002" });
  mockPhaseResult("release.ready", 0);
  mockPhaseResult("leitstand.certify", 0, { decisionId: "dec-002" });
  mockPhaseResult("leitstand.dev-deploy", 0, { deploymentUrl: "https://dev2.example.com" });

  const result = await runLeitstandHotfixDevDeploy(
    makeInput({ site: "test-sys", mission: "m000002" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.phases.commit.skipped).toBe(true);
  expect(result.data!.phases.commit.commitSha).toBeUndefined();
  expect(result.data!.deploymentUrl).toBe("https://dev2.example.com");
  assertAllPhaseCallsValid();
});

test("validate.postbuild fails, mission.validate succeeds — mode: full", async () => {
  mockExecSync.mockReturnValue(""); // clean
  mockPhaseResult("validate.postbuild", 1);
  mockPhaseResult("mission.validate", 0);
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);
  mockPhaseResult("release.prepare", 0, { releaseId: "test-sys-r000003" });
  mockPhaseResult("release.ready", 0);
  mockPhaseResult("leitstand.certify", 0, { decisionId: "dec-003" });
  mockPhaseResult("leitstand.dev-deploy", 0, { deploymentUrl: "https://dev3.example.com" });

  const result = await runLeitstandHotfixDevDeploy(
    makeInput({ site: "test-sys", mission: "m000003" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.phases.validate.mode).toBe("full");
  expect(result.data!.phases.validate.passed).toBe(true);
  assertAllPhaseCallsValid();
});

test("validate.postbuild fails, mission.validate fails — failingPhase: validate", async () => {
  mockExecSync.mockReturnValue(""); // clean
  mockPhaseResult("validate.postbuild", 1);
  mockPhaseResult("mission.validate", 1);

  const result = await runLeitstandHotfixDevDeploy(
    makeInput({ site: "test-sys", mission: "m000004" }),
    context,
  );

  expect(result.exitCode).toBe(1);
  expect(result.data!.failingPhase).toBe("validate");
  expect(result.data!.phases.validate.passed).toBe(false);
});

test("mission.close fails — failingPhase: close, phases 5-7 not executed", async () => {
  mockExecSync.mockReturnValue(""); // clean
  mockPhaseResult("validate.postbuild", 0);
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 1);

  const result = await runLeitstandHotfixDevDeploy(
    makeInput({ site: "test-sys", mission: "m000005" }),
    context,
  );

  expect(result.exitCode).toBe(1);
  expect(result.data!.failingPhase).toBe("close");
  expect(result.data!.phases.close.ok).toBe(false);
  expect(result.data!.phases.release.prepared).toBe(false);
});

test("leitstand.certify fails — failingPhase: certify, phase 7 not executed", async () => {
  mockExecSync.mockReturnValue(""); // clean
  mockPhaseResult("validate.postbuild", 0);
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);
  mockPhaseResult("release.prepare", 0, { releaseId: "test-sys-r000006" });
  mockPhaseResult("release.ready", 0);
  mockPhaseResult("leitstand.certify", 1);

  const result = await runLeitstandHotfixDevDeploy(
    makeInput({ site: "test-sys", mission: "m000006" }),
    context,
  );

  expect(result.exitCode).toBe(1);
  expect(result.data!.failingPhase).toBe("certify");
  expect(result.data!.phases.certify.passed).toBe(false);
  expect(result.data!.phases.deploy.deployed).toBe(false);
});

test("--message flag passed to mission.git.commit", async () => {
  mockExecSync.mockReturnValueOnce("M file.ts\n"); // git status (dirty)
  mockPhaseResult("mission.git.commit", 0);
  mockExecSync.mockReturnValueOnce("def456\n"); // git rev-parse HEAD
  mockPhaseResult("validate.postbuild", 0);
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);
  mockPhaseResult("release.prepare", 0, { releaseId: "test-sys-r000007" });
  mockPhaseResult("release.ready", 0);
  mockPhaseResult("leitstand.certify", 0, { decisionId: "dec-007" });
  mockPhaseResult("leitstand.dev-deploy", 0, { deploymentUrl: "https://dev7.example.com" });

  await runLeitstandHotfixDevDeploy(
    makeInput({ site: "test-sys", mission: "m000007", message: "hotfix: fix typo" }),
    context,
  );

  const commitCall = mockExecuteKernelCommand.mock.calls.find(
    (c: unknown[]) => (c[0] as { commandName: string }).commandName === "mission.git.commit",
  );
  expect(commitCall).toBeDefined();
  const argv = (commitCall![0] as { argv: string[] }).argv;
  expect(argv).toContain("--message=hotfix: fix typo");
});

test("release.prepare is called without --release flag (derives releaseId internally)", async () => {
  mockExecSync.mockReturnValue(""); // clean
  mockPhaseResult("validate.postbuild", 0);
  mockPhaseResult("mission.reconcile", 0);
  mockPhaseResult("mission.close", 0);
  mockPhaseResult("release.prepare", 0, { releaseId: "test-sys-r000008" });
  mockPhaseResult("release.ready", 0);
  mockPhaseResult("leitstand.certify", 0, { decisionId: "dec-008" });
  mockPhaseResult("leitstand.dev-deploy", 0, { deploymentUrl: "https://dev8.example.com" });

  const result = await runLeitstandHotfixDevDeploy(
    makeInput({ site: "test-sys", mission: "m000008" }),
    context,
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.releaseId).toBe("test-sys-r000008");

  const prepareCall = mockExecuteKernelCommand.mock.calls.find(
    (c: unknown[]) => (c[0] as { commandName: string }).commandName === "release.prepare",
  );
  expect(prepareCall).toBeDefined();
  const argv = (prepareCall![0] as { argv: string[] }).argv;
  expect(argv).not.toContainEqual(expect.stringContaining("--release"));
});

test("--site is required", async () => {
  await expect(
    runLeitstandHotfixDevDeploy(makeInput({ mission: "m000008" }), context),
  ).rejects.toThrow("--site is required");
});

test("--mission is required", async () => {
  await expect(
    runLeitstandHotfixDevDeploy(makeInput({ site: "test-sys" }), context),
  ).rejects.toThrow("--mission is required");
});
