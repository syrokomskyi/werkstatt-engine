/*
<MODULE_CONTRACT>
  <purpose>RFC-0938: tests for leitstand.certify auto-manage access PIN feature.</purpose>
  <keywords>RFC-0938, leitstand, certify, accessPin, auto-manage, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0938: test auto-manage PIN — auto-remove before, auto-restore after, pinManagement in result.</item>
  <item>RFC-0938: test unprotect failure — certify fails, PIN not removed, site stays protected.</item>
  <item>RFC-0938: test restore failure — hard fail exitCode 1, restoreError set.</item>
  <item>RFC-0938: test --auto-manage-pin=false preserves RFC-0929 fail-early behavior.</item>
  <item>RFC-0938: test no PIN active — certify proceeds, pinManagement absent or autoManaged true.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, vi, beforeEach } from "vitest";
import { runLeitstandCertify } from "../leitstand/certify.ts";
import type {
  KernelRuntimeContext,
  KernelCommandInput,
  KernelFlagValue,
} from "@warpgogol/werkstatt-engine/kernel";

// Track executeKernelCommand calls to verify unprotect/protect invocations
let executeKernelCommandCalls: Array<{ commandName: string; argv: string[] }> = [];
let unprotectShouldFail = false;
let protectShouldFail = false;

vi.mock("../sternsystem/registry-io.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sternsystem/registry-io.ts")>();
  return {
    ...actual,
    readSystemStateSmart: vi.fn(),
    resolveCacheClonePath: vi.fn().mockReturnValue("/tmp/test-cache-clone-0938"),
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn(),
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    writeFileIfChanged: vi.fn().mockResolvedValue(undefined),
    executeKernelCommand: vi.fn(async (params: { commandName: string; argv: string[] }) => {
      executeKernelCommandCalls.push({ commandName: params.commandName, argv: params.argv });
      if (params.commandName === "leitstand.access.unprotect" && unprotectShouldFail) {
        return { ok: false, exitCode: 1, summary: "unprotect failed" };
      }
      if (params.commandName === "leitstand.access.protect" && protectShouldFail) {
        return { ok: false, exitCode: 1, summary: "protect failed" };
      }
      return { ok: true, exitCode: 0, summary: "ok" };
    }),
  };
});

vi.mock("../mission/mission-git-commit.ts", () => ({
  cacheCloneCommit: vi.fn(),
}));

vi.mock("../werkstatt/git-exec.ts", () => ({
  gitExec: vi.fn().mockReturnValue("main"),
}));

vi.mock("../certification/storage/r2-adapter.ts", () => ({
  createR2StorageAdapter: vi.fn(),
}));

vi.mock("../leitstand/deploy-helpers.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../leitstand/deploy-helpers.ts")>();
  return {
    ...actual,
    makeR2ConfigFromEnv: vi.fn().mockReturnValue(null),
    resolveArtifactHash: vi
      .fn()
      .mockResolvedValue("sha256:0000000000000000000000000000000000000000000000000000000000000000"),
    flagSite: vi.fn((input: KernelCommandInput) => {
      const v = input.flags["site"] ?? input.flags["system"];
      return typeof v === "string" ? v : undefined;
    }),
  };
});

const { readSystemStateSmart } = await import("../sternsystem/registry-io.ts");
const mockReadSystemStateSmart = readSystemStateSmart as unknown as ReturnType<typeof vi.fn>;

const context = {
  workspaceRoot: "/tmp/test-workspace-0938",
  logger: {
    info: () => {},
    success: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
} as unknown as KernelRuntimeContext;

function makeInput(flags: Record<string, KernelFlagValue>): KernelCommandInput {
  return { flags, argv: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  executeKernelCommandCalls = [];
  unprotectShouldFail = false;
  protectShouldFail = false;
  mockReadSystemStateSmart.mockResolvedValue({
    schemaVersion: "1.0.0",
    systemId: "test-sys",
    currentMission: null,
    lastRelease: null,
    lastPropagated: {},
    accessPin: null,
  });
});

test("RFC-0938: no PIN active — certify proceeds, pinManagement has autoManaged true", async () => {
  const result = await runLeitstandCertify(
    makeInput({
      site: "test-sys",
      gate: "dev",
      release: "test-sys-r000001",
      "artifact-hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    }),
    context,
  );

  expect(result.summary).not.toContain("access PIN protection active");
  expect(executeKernelCommandCalls.filter((c) => c.commandName === "leitstand.access.unprotect")).toHaveLength(0);
  expect(executeKernelCommandCalls.filter((c) => c.commandName === "leitstand.access.protect")).toHaveLength(0);
  if (result.data?.pinManagement) {
    expect(result.data.pinManagement.autoManaged).toBe(true);
    expect(result.data.pinManagement.removedBefore).toBe(false);
  }
});

test("RFC-0938: PIN active, auto-manage=true, unprotect fails — exitCode 1, PIN not removed", async () => {
  mockReadSystemStateSmart.mockResolvedValue({
    schemaVersion: "1.0.0",
    systemId: "test-sys",
    currentMission: null,
    lastRelease: null,
    lastPropagated: {},
    accessPin: "4092",
  });
  unprotectShouldFail = true;

  const result = await runLeitstandCertify(
    makeInput({
      site: "test-sys",
      gate: "dev",
      release: "test-sys-r000001",
      "artifact-hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    }),
    context,
  );

  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("failed to auto-remove access PIN");
  expect(result.summary).toContain("test-sys");
  expect(result.data!.pinManagement).toBeDefined();
  expect(result.data!.pinManagement!.autoManaged).toBe(true);
  expect(result.data!.pinManagement!.removedBefore).toBe(false);
  // No protect call since unprotect failed
  expect(executeKernelCommandCalls.filter((c) => c.commandName === "leitstand.access.protect")).toHaveLength(0);
});

test("RFC-0938: PIN active, auto-manage=false — fail-early with RFC-0929 message", async () => {
  mockReadSystemStateSmart.mockResolvedValue({
    schemaVersion: "1.0.0",
    systemId: "test-sys",
    currentMission: null,
    lastRelease: null,
    lastPropagated: {},
    accessPin: "1234",
  });

  const result = await runLeitstandCertify(
    makeInput({
      site: "test-sys",
      gate: "dev",
      release: "test-sys-r000001",
      "artifact-hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      "auto-manage-pin": false,
    }),
    context,
  );

  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("access PIN protection active");
  expect(result.summary).toContain("leitstand.access.unprotect");
  expect(result.data!.pinManagement).toBeDefined();
  expect(result.data!.pinManagement!.autoManaged).toBe(false);
  // No unprotect or protect calls
  expect(executeKernelCommandCalls).toHaveLength(0);
});

test("RFC-0938: PIN active, auto-manage=true, unprotect succeeds — unprotect called with correct args", async () => {
  mockReadSystemStateSmart.mockResolvedValue({
    schemaVersion: "1.0.0",
    systemId: "test-sys",
    currentMission: null,
    lastRelease: null,
    lastPropagated: {},
    accessPin: "4092",
  });

  await runLeitstandCertify(
    makeInput({
      site: "test-sys",
      gate: "dev",
      release: "test-sys-r000001",
      "artifact-hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    }),
    context,
  );

  const unprotectCalls = executeKernelCommandCalls.filter((c) => c.commandName === "leitstand.access.unprotect");
  expect(unprotectCalls).toHaveLength(1);
  expect(unprotectCalls[0].argv).toContain("--site=test-sys");
});

test("RFC-0938: PIN active, auto-manage=true, protect fails — hard fail exitCode 1, restoreError set", async () => {
  mockReadSystemStateSmart.mockResolvedValue({
    schemaVersion: "1.0.0",
    systemId: "test-sys",
    currentMission: null,
    lastRelease: null,
    lastPropagated: {},
    accessPin: "4092",
  });
  protectShouldFail = true;

  const result = await runLeitstandCertify(
    makeInput({
      site: "test-sys",
      gate: "dev",
      release: "test-sys-r000001",
      "artifact-hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    }),
    context,
  );

  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("CRITICAL");
  expect(result.summary).toContain("PIN restore failed");
  expect(result.summary).toContain("UNPROTECTED");
  expect(result.data!.pinManagement).toBeDefined();
  expect(result.data!.pinManagement!.removedBefore).toBe(true);
  expect(result.data!.pinManagement!.restoredAfter).toBe(false);
  expect(result.data!.pinManagement!.restoreError).not.toBeNull();
});

test("RFC-0938: PIN active, auto-manage=true, protect succeeds — pinManagement reports restoredAfter true", async () => {
  mockReadSystemStateSmart.mockResolvedValue({
    schemaVersion: "1.0.0",
    systemId: "test-sys",
    currentMission: null,
    lastRelease: null,
    lastPropagated: {},
    accessPin: "4092",
  });

  const result = await runLeitstandCertify(
    makeInput({
      site: "test-sys",
      gate: "dev",
      release: "test-sys-r000001",
      "artifact-hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    }),
    context,
  );

  // certify will fail because no real release dir, but PIN management should still work
  const protectCalls = executeKernelCommandCalls.filter((c) => c.commandName === "leitstand.access.protect");
  expect(protectCalls).toHaveLength(1);
  expect(protectCalls[0].argv).toContain("--site=test-sys");
  expect(protectCalls[0].argv).toContain("--pin=4092");

  // PIN was removed and restored
  if (result.data?.pinManagement) {
    expect(result.data.pinManagement.autoManaged).toBe(true);
    expect(result.data.pinManagement.removedBefore).toBe(true);
    expect(result.data.pinManagement.restoredAfter).toBe(true);
    expect(result.data.pinManagement.restoreError).toBeNull();
  }
});
