/*
<MODULE_CONTRACT>
  <purpose>RFC-0938/RFC-1284: tests for leitstand.certify access PIN management —
  suspend-before-measure, resume-in-finally, stale-marker resume on entry,
  target-aware gating (candidate-preview never touches ACCESS_PIN).</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1207: candidate-preview certify — wrangler dev on releases/<id>/dist/server measures the candidate artifact</item>
  <item>RFC-1284: suspend/resume vocabulary — removedBefore/restoredAfter →
  suspended/resumed/staleResumed; access.unprotect/protect → access.suspend/resume;
  fail-early recommends access.suspend; stale-marker resume on entry;
  candidate-preview never touches the secret.</item>
  <item>RFC-1284 review (REVIEW-CODE-2026-10-15-02 F2, Q-7): AC-16 semantics —
  flag=false + marker at entry proceeds without resume (secrets untouched);
  certify state reads move to the non-smart cache-clone store (Q-6).
  Explicit per-test timeout 30s: acceptance probes run vitest from the repo
  root without this package's vitest.config (default 5s timeout < the real
  5s PIN-deletion propagation sleep).</item>
  <item>RFC-1284: fix review REVIEW-CODE-2026-10-15-02: RFC-1284 — single-store marker, flag=false proceed, surfaced reconcile

F1: marker store unified on the git-tracked cache clone — access commands,
certify entry check, and deploy reconcile all use non-smart
readSystemState/writeSystemState (decisions Q-6); the mission-window
blindness and the DNA-106 false-resume are gone.
F2: --auto-manage-pin=false + suspension at entry skips entry-resume and
proceeds on the open channel (decisions Q-7) — RFC/AC-8 text amended.
F3: accessReconcile surfaced in data + summary of dev-deploy/propagate.
F4: CHANGE_SUMMARY items on all touched files.
F5: sternsystem.validate declares ACCESS-01/02 + system-state.yaml reads.
F6: isProtectedLiveTarget exported and covered (AC-12 probe repointed).
F7: fresh-read ordering proven — suspension opened mid-deploy suppresses
the re-assert.</item>
  <item>RFC-1284: fix review REVIEW-CODE-2026-10-15-02 (follow-up): explicit 30s test timeouts

Acceptance probes spawn vitest from the repo root without the package
vitest.config — the default 5s timeout raced the real 5s PIN-deletion
propagation sleep and failed four probes (AC-6/8/11/16).</item>
  <history>RFC-0938, RFC-1126</history>
</CHANGE_SUMMARY>
*/

import { mkdirSync } from "node:fs";
import { test, expect, vi, beforeEach } from "vitest";
import { runLeitstandCertify } from "../leitstand/certify.ts";
import type {
  KernelRuntimeContext,
  KernelCommandInput,
  KernelFlagValue,
} from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

// Track executeKernelCommand calls to verify suspend/resume invocations
let executeKernelCommandCalls: Array<{ commandName: string; argv: string[] }> = [];
let suspendShouldFail = false;
let resumeShouldFail = false;

vi.mock("../sternsystem/registry-io.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sternsystem/registry-io.ts")>();
  return {
    ...actual,
    readSystemState: vi.fn(),
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
      if (params.commandName === "leitstand.access.suspend" && suspendShouldFail) {
        return { ok: false, exitCode: 1, summary: "suspend failed" };
      }
      if (params.commandName === "leitstand.access.resume" && resumeShouldFail) {
        return { ok: false, exitCode: 1, summary: "resume failed" };
      }
      return { ok: true, exitCode: 0, summary: "ok" };
    }),
  };
});

vi.mock("../leitstand/candidate-preview.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../leitstand/candidate-preview.ts")>();
  return {
    ...actual,
    provisionCandidatePreview: vi.fn(async () => {
      throw new Error("preview provisioning unavailable in tests");
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
    resolveArtifactHash: vi.fn().mockResolvedValue({
      hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      source: "flag",
    }),
    flagSite: vi.fn((input: KernelCommandInput) => {
      const v = input.flags["site"] ?? input.flags["system"];
      return typeof v === "string" ? v : undefined;
    }),
  };
});

const { readSystemState } = await import("../sternsystem/registry-io.ts");
// certify reads the cache-clone marker store via non-smart readSystemState (Q-6).
const mockReadSystemState = readSystemState as unknown as ReturnType<typeof vi.fn>;

const WORKSPACE_ROOT = "/tmp/test-workspace-0938";

const context = {
  io: createDefaultIO().io,
  workspaceRoot: WORKSPACE_ROOT,
  logger: {
    info: () => {},
    success: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
} as unknown as KernelRuntimeContext;

function makeInput(flags: Record<string, KernelFlagValue>): KernelCommandInput {
  // RFC-1207: these tests exercise PIN management against a protected live
  // host. Channel audit mode reproduces the legacy resolution path (no
  // dist/server fixture needed, no wrangler dev spawn).
  return { flags: { target: "channel", ...flags }, argv: [] };
}

function makeState(overrides: Record<string, unknown>) {
  return {
    schemaVersion: "1.0.0",
    systemId: "test-sys",
    currentMission: null,
    lastRelease: null,
    lastPropagated: {},
    accessPin: null,
    accessPinSuspended: null,
    passportRequired: false,
    ownershipRequired: false,
    ...overrides,
  };
}

const STALE_MARKER = {
  at: "2026-10-15T08:00:00.000Z",
  by: "leitstand.certify",
  operationId: "certify-stale",
};

function accessCalls(commandName: string) {
  return executeKernelCommandCalls.filter((c) => c.commandName === commandName);
}

beforeEach(() => {
  vi.clearAllMocks();
  executeKernelCommandCalls = [];
  suspendShouldFail = false;
  resumeShouldFail = false;
  mockReadSystemState.mockResolvedValue(makeState({}));
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
  expect(accessCalls("leitstand.access.suspend")).toHaveLength(0);
  expect(accessCalls("leitstand.access.resume")).toHaveLength(0);
  if (result.data?.pinManagement) {
    expect(result.data.pinManagement.autoManaged).toBe(true);
    expect(result.data.pinManagement.suspended).toBe(false);
  }
});

test(
  "RFC-1284: PIN active, auto-manage=true, channel target — suspends with certify provenance",
  { timeout: 30_000 },
  async () => {
    mockReadSystemState.mockResolvedValue(makeState({ accessPin: "4092" }));

    await runLeitstandCertify(
      makeInput({
        site: "test-sys",
        gate: "dev",
        release: "test-sys-r000001",
        "artifact-hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      }),
      context,
    );

    const suspendCalls = accessCalls("leitstand.access.suspend");
    expect(suspendCalls).toHaveLength(1);
    expect(suspendCalls[0].argv).toContain("--site=test-sys");
    expect(suspendCalls[0].argv).toContain("--by=leitstand.certify");
    expect(
      suspendCalls[0].argv.some((a) => a.startsWith("--operation-id=certify-")),
      "suspend must carry the certify operation id into the marker (AC-1/AC-11)",
    ).toBe(true);
  },
);

test(
  "RFC-1284: PIN active, auto-manage=true, suspend fails — exitCode 1, no resume attempted",
  { timeout: 30_000 },
  async () => {
    mockReadSystemState.mockResolvedValue(makeState({ accessPin: "4092" }));
    suspendShouldFail = true;

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
    expect(result.summary).toContain("failed to suspend access PIN");
    expect(result.summary).toContain("test-sys");
    expect(result.data!.pinManagement).toBeDefined();
    expect(result.data!.pinManagement!.autoManaged).toBe(true);
    expect(result.data!.pinManagement!.suspended).toBe(false);
    expect(accessCalls("leitstand.access.resume")).toHaveLength(0);
  },
);

test(
  "RFC-1284: PIN active, auto-manage=false — fail-early recommends access.suspend",
  { timeout: 30_000 },
  async () => {
    mockReadSystemState.mockResolvedValue(makeState({ accessPin: "1234" }));

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
    expect(
      result.summary,
      "fail-early must recommend access.suspend — unprotect erases desired state (RFC-1284)",
    ).toContain("leitstand.access.suspend");
    expect(result.summary).not.toContain("leitstand.access.unprotect");
    expect(result.data!.pinManagement).toBeDefined();
    expect(result.data!.pinManagement!.autoManaged).toBe(false);
    expect(executeKernelCommandCalls).toHaveLength(0);
  },
);

test(
  "RFC-1284: PIN active, resume fails in finally — hard fail exitCode 1, restoreError set",
  { timeout: 30_000 },
  async () => {
    mockReadSystemState.mockResolvedValue(makeState({ accessPin: "4092" }));
    resumeShouldFail = true;

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
    expect(result.summary).toContain("PIN resume failed");
    expect(result.summary).toContain("leitstand.access.resume");
    expect(result.data!.pinManagement).toBeDefined();
    expect(result.data!.pinManagement!.suspended).toBe(true);
    expect(result.data!.pinManagement!.resumed).toBe(false);
    expect(result.data!.pinManagement!.restoreError).not.toBeNull();
  },
);

test(
  "RFC-1284: PIN active, suspend+resume succeed — pinManagement reports both",
  { timeout: 30_000 },
  async () => {
    mockReadSystemState.mockResolvedValue(makeState({ accessPin: "4092" }));

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
    const resumeCalls = accessCalls("leitstand.access.resume");
    expect(resumeCalls).toHaveLength(1);
    expect(resumeCalls[0].argv).toContain("--site=test-sys");

    if (result.data?.pinManagement) {
      expect(result.data.pinManagement.autoManaged).toBe(true);
      expect(result.data.pinManagement.suspended).toBe(true);
      expect(result.data.pinManagement.resumed).toBe(true);
      expect(result.data.pinManagement.restoreError).toBeNull();
    }
  },
);

test(
  "RFC-1284: candidate-preview target never touches ACCESS_PIN (AC-6)",
  { timeout: 30_000 },
  async () => {
    // The artifact-missing guard precedes PIN handling, so materialize the
    // expected dist/server dir to reach the pin block.
    mkdirSync(`${WORKSPACE_ROOT}/releases/test-sys-r000001/dist/server`, { recursive: true });
    mockReadSystemState.mockResolvedValue(makeState({ accessPin: "4092" }));

    await runLeitstandCertify(
      {
        flags: {
          site: "test-sys",
          gate: "dev",
          release: "test-sys-r000001",
          "artifact-hash":
            "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          // no --target → candidate-preview default
        },
        argv: [],
      } as unknown as KernelCommandInput,
      context,
    );

    expect(
      accessCalls("leitstand.access.suspend"),
      "candidate-preview certification must never suspend — the preview is a local wrangler dev, not the protected channel (AC-6)",
    ).toHaveLength(0);
    expect(accessCalls("leitstand.access.resume")).toHaveLength(0);
    expect(accessCalls("leitstand.access.unprotect")).toHaveLength(0);
    expect(accessCalls("leitstand.access.protect")).toHaveLength(0);
  },
);

test(
  "RFC-1284: stale suspension marker — certify resumes before producers (AC-8)",
  { timeout: 30_000 },
  async () => {
    mockReadSystemState.mockResolvedValue(
      makeState({ accessPin: "4092", accessPinSuspended: STALE_MARKER }),
    );

    const result = await runLeitstandCertify(
      makeInput({
        site: "test-sys",
        gate: "dev",
        release: "test-sys-r000001",
        "artifact-hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      }),
      context,
    );

    const resumeCalls = accessCalls("leitstand.access.resume");
    expect(
      resumeCalls.length,
      "stale marker must trigger access.resume on entry — crash recovery before any producer runs (AC-8)",
    ).toBeGreaterThanOrEqual(1);
    expect(resumeCalls[0].argv).toContain("--site=test-sys");
    // Entry-resume ran, then the live-target run suspended again and resumed in finally.
    if (result.data?.pinManagement) {
      expect(result.data.pinManagement.staleResumed).toBe(true);
    }
  },
);

test(
  "RFC-1284: stale marker resume fails on entry — certify hard-fails before producers",
  { timeout: 30_000 },
  async () => {
    mockReadSystemState.mockResolvedValue(
      makeState({ accessPin: "4092", accessPinSuspended: STALE_MARKER }),
    );
    resumeShouldFail = true;

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
    expect(result.summary).toContain("failed to resume access PIN suspension");
    expect(result.data!.pinManagement!.restoreError).not.toBeNull();
    expect(accessCalls("leitstand.access.suspend")).toHaveLength(0);
  },
);

test(
  "RFC-1284: auto-manage=false with active suspension — proceeds without resume (AC-16, Q-7)",
  { timeout: 30_000 },
  async () => {
    mockReadSystemState.mockResolvedValue(
      makeState({ accessPin: "4092", accessPinSuspended: STALE_MARKER }),
    );

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

    // flag=false + marker at entry: no resume, no suspend — secrets untouched.
    expect(accessCalls("leitstand.access.resume")).toHaveLength(0);
    expect(accessCalls("leitstand.access.suspend")).toHaveLength(0);
    // The debug workflow proceeds: no fail-early on the open channel.
    expect(result.summary ?? "").not.toContain("access PIN protection active");
    if (result.data?.pinManagement) {
      expect(result.data.pinManagement.autoManaged).toBe(false);
      expect(result.data.pinManagement.staleResumed).toBe(false);
    }
  },
);
