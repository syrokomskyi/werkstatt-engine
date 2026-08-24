/*
<MODULE_CONTRACT>
  <purpose>RFC-0929: tests for leitstand.certify accessPin pre-flight check and tryReuseEvidence status=fail skip.</purpose>
  <keywords>RFC-0929, leitstand, certify, accessPin, evidence reuse, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0929: test accessPin pre-flight check blocks certify before producer execution.</item>
  <item>RFC-0929: test tryReuseEvidence skips gate decisions with status=fail.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, vi, beforeEach } from "vitest";
import { runLeitstandCertify } from "../leitstand/certify.ts";
import type {
  KernelRuntimeContext,
  KernelCommandInput,
  KernelFlagValue,
} from "@warpgogol/werkstatt-engine/kernel";

vi.mock("../sternsystem/registry-io.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sternsystem/registry-io.ts")>();
  return {
    ...actual,
    readSystemStateSmart: vi.fn(),
    resolveCacheClonePath: vi.fn().mockReturnValue("/tmp/test-cache-clone"),
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

const fsMock = await import("node:fs/promises");
const mockReaddir = fsMock.readdir as unknown as ReturnType<typeof vi.fn>;
const mockReadFile = fsMock.readFile as unknown as ReturnType<typeof vi.fn>;

const context = {
  workspaceRoot: "/tmp/test-workspace",
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
  mockReadSystemStateSmart.mockResolvedValue({
    schemaVersion: "1.0.0",
    systemId: "test-sys",
    currentMission: null,
    lastRelease: null,
    lastPropagated: {},
    accessPin: null,
  });
});

test("RFC-0929: certify fails with clear message when accessPin is set", async () => {
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
      gate: "alt",
      release: "test-sys-r000001",
      "artifact-hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      "auto-manage-pin": false,
    }),
    context,
  );

  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("access PIN protection active");
  expect(result.summary).toContain("leitstand.access.unprotect");
  expect(result.summary).toContain("test-sys");
  expect(result.data!.status).toBe("fail");
  expect(result.data!.producerCount).toBe(0);
  expect(result.data!.pinManagement).toEqual({
    autoManaged: false,
    removedBefore: false,
    restoredAfter: false,
    restoreError: null,
  });
});

test("RFC-0929: --force does not bypass accessPin check", async () => {
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
      force: true,
      "auto-manage-pin": false,
    }),
    context,
  );

  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("access PIN protection active");
});

test("RFC-0929: certify proceeds when accessPin is null", async () => {
  // accessPin is null (default mock) — certify should proceed past the pre-flight check.
  // It will fail later because no real release dir exists, but the failure should NOT
  // be the accessPin pre-flight error.
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
});

test("RFC-0929: tryReuseEvidence skips gate decisions with status=fail", async () => {
  const artifactHash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  const releaseId = "test-sys-r000001";

  mockReaddir.mockImplementation(async (dirPath: string) => {
    if (typeof dirPath === "string" && dirPath.includes("gate-decisions")) {
      return [`${releaseId}-dev.json`];
    }
    return [];
  });

  mockReadFile.mockImplementation(async (filePath: string) => {
    if (typeof filePath === "string" && filePath.includes(`${releaseId}-dev.json`)) {
      return JSON.stringify({
        schema: "werkstatt/gate-decision@1",
        decisionId: "dec-test-fail-01",
        candidateId: "test-sys",
        policyBundleRoot: artifactHash,
        gate: "dev",
        evaluationCut: 1,
        selectedEvidence: [],
        status: "fail",
        coverage: {
          schema: "werkstatt/coverage-report@1",
          totalRequirements: 1,
          coveredRequirements: 0,
          uncoveredRequirements: ["req-astro-mission-check"],
        },
        reasons: ["mission.check failed"],
        actionPackRef: null,
        decidedAt: "2026-08-23T00:00:00.000Z",
      });
    }
    throw new Error(`Unexpected readFile: ${filePath}`);
  });

  const result = await runLeitstandCertify(
    makeInput({
      site: "test-sys",
      gate: "alt",
      release: releaseId,
      "artifact-hash": artifactHash,
    }),
    context,
  );

  expect(result.data!.producerCount).not.toBe(0);
});
