/*
<MODULE_CONTRACT>
  <purpose>RFC-1284: Tests for the post-propagate ACCESS_PIN reconcile in
  executeDeployPhases — re-asserts the declared pin on dev/alt channels after a
  successful deploy, skips suspended/unprotected/main, and degrades failures to
  a non-fatal diagnostic on the result.</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1284: initial — deploy-time ACCESS_PIN reconcile coverage (AC-7).</item>
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
  <item>RFC-1325: provisional workers.dev as first-class site host

Single host predicate module in werkstatt-shared; provisional registration derives dev/alt/main workers.dev channels from the account subdomain; first dev deploy auto-protects provisional hosts; provisional main responses carry noindex; dns-aid skips provisional sites; site.domain.adopt cuts over to a custom domain.</item>
  <history>RFC-1284</history>
</CHANGE_SUMMARY>
*/

import { afterEach, beforeEach, test, expect, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { executeDeployPhases } from "../deploy-execution.ts";
import { verifyFreshness } from "../leitstand-commands.ts";
import type { DeployExecutionContext } from "../deploy-execution.ts";
import type {
  DeploymentAdapter,
  PropagateInput,
  RollbackInput,
  RollbackResult,
  HealthInput,
} from "../adapter.ts";
import type { PropagationResult, HealthCheck } from "@warpgogol/werkstatt-engine/schemas";
import type { AuthorizeResult } from "../deploy-helpers.ts";
import type { DeploymentStaticConfig } from "@warpgogol/werkstatt-engine/schemas";
import type { Sha256Digest } from "@warpgogol/werkstatt-shared/fingerprint";

let deploySystemState: Record<string, unknown> = {};
let wranglerSecretPutCalls: Array<{ workerName: string; secretName: string; value: string }> = [];
let wranglerSecretPutExitCode = 0;

vi.mock("../leitstand-commands.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../leitstand-commands.ts")>();
  return {
    ...actual,
    verifyFreshness: vi.fn().mockResolvedValue({
      verified: false,
      cdnDistTreeHash: null,
    }),
  };
});

// RFC-1138: dns.record.upsert runs via executeKernelCommand — mock so the tmp
// workspace deploy reaches propagate.
vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelCommand: vi.fn().mockResolvedValue({ exitCode: 0, summary: "ok" }),
  };
});

vi.mock("../../sternsystem/registry-io.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../sternsystem/registry-io.ts")>();
  return {
    ...actual,
    // Reconcile reads the cache-clone store (non-smart) — REVIEW-CODE-2026-10-15-02 F1/Q-6.
    readSystemState: vi.fn(async () => deploySystemState),
    readSystemStateSmart: vi.fn(async () => deploySystemState),
    writeSystemStateSmart: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../adapters/wrangler-secrets.ts", () => ({
  runWranglerSecretPut: vi.fn(async (workerName: string, secretName: string, value: string) => {
    wranglerSecretPutCalls.push({ workerName, secretName, value });
    return { exitCode: wranglerSecretPutExitCode, stdout: "", stderr: "" };
  }),
  runWranglerSecretDelete: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
}));

function makeAdapter(): DeploymentAdapter {
  return {
    name: "cloudflare-workers",
    async propagate(input: PropagateInput): Promise<PropagationResult> {
      return {
        systemId: input.systemId,
        releaseId: input.releaseId,
        state: "succeeded",
        deploymentUrl: input.url,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        healthChecks: [],
      };
    },
    async rollback(input: RollbackInput): Promise<RollbackResult> {
      return {
        systemId: input.systemId,
        channel: input.channel,
        state: "succeeded",
        workerName: input.workerName,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        stdout: "",
        stderr: "",
      };
    },
    async health(
      _input: HealthInput,
    ): Promise<{ state: "healthy" | "unhealthy" | "unknown"; checks: HealthCheck[] }> {
      return { state: "healthy", checks: [] };
    },
    getLimits() {
      return { maxTotalSize: 100 * 1024 * 1024, maxFileSize: 10 * 1024 * 1024 };
    },
    purgeCapable() {
      return false;
    },
    bootSmokeCapable() {
      return false;
    },
  };
}

const systemConfig: DeploymentStaticConfig = {
  adapter: "cloudflare-workers",
  channels: {
    // RFC-1325: custom-domain dev channel — a workers.dev URL would trigger provisional auto-protect.
    dev: { workerName: "test-dev", url: "https://dev.example.com" },
    alt: { workerName: "test-alt", url: "https://alt.example.com" },
    main: { workerName: "test-main", url: "https://main.example.com" },
  },
};

const authResult: AuthorizeResult = {
  ok: true,
  outcome: {
    ok: true,
    authorized: true,
    gate: "dev-deploy",
    channel: "dev",
    candidateId: "test-sys",
    decisionId: "gd-000001",
    requiresMainVerification: false,
    requiresDurableSync: false,
  },
  gateDecision: {
    schema: "werkstatt/gate-decision@1",
    decisionId: "gd-000001",
    candidateId: "test-sys",
    policyBundleRoot:
      "sha256:0000000000000000000000000000000000000000000000000000000000000000" as Sha256Digest,
    gate: "dev",
    evaluationCut: 1,
    selectedEvidence: [],
    status: "pass",
    coverage: {
      schema: "werkstatt/coverage-report@1",
      totalRequirements: 9,
      coveredRequirements: 9,
      uncoveredRequirements: [],
    },
    reasons: [],
    actionPackRef: null,
    decidedAt: new Date().toISOString(),
  },
};

function makeCtx(adapter: DeploymentAdapter, workspaceRoot: string): DeployExecutionContext {
  return {
    systemId: "test-sys",
    releaseId: "r000001",
    candidateId: "test-sys",
    artifactHash: "sha256:abc" as Sha256Digest,
    authResult,
    workspaceRoot,
    cacheCloneDir: join(workspaceRoot, "..", "systems-cache", "test-sys"),
    systemConfig,
    adapter,
    operationId: "op-test",
    gateDecisionPath: "/tmp/gd.json",
    secretsFilePath: undefined,
    skipEvidenceSync: true,
    forceBuild: false,
  };
}

function makeWorkspace(): string {
  const tmp = mkdtempSync(join(tmpdir(), "leitstand-reconcile-test-"));
  rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  writeFileSync(join(tmp, "package.json"), JSON.stringify({ version: "1.0.0" }) + "\n");
  const distDir = join(tmp, "releases", "r000001", "dist", "client");
  mkdirSync(distDir, { recursive: true });
  return tmp;
}

beforeEach(() => {
  vi.clearAllMocks();
  wranglerSecretPutCalls = [];
  wranglerSecretPutExitCode = 0;
  deploySystemState = {
    schemaVersion: "1.0.0",
    systemId: "test-sys",
    currentMission: null,
    lastRelease: null,
    lastPropagated: {},
    accessPin: null,
    accessPinSuspended: null,
    passportRequired: false,
    ownershipRequired: false,
  };
  // Same kernel-env leakage guard as deploy-execution-purge.test.ts.
  vi.stubEnv("SIGNING_PRIVATE_KEY", "");
  vi.stubEnv("SIGNING_PRIVATE_KEY_PATH", "");
  vi.stubEnv("PUBLIC_KEY_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("RFC-1284: dev deploy reconciles ACCESS_PIN when protection is desired and not suspended", async () => {
  const tmp = makeWorkspace();
  try {
    deploySystemState = { ...deploySystemState, accessPin: "4092" };
    const result = await executeDeployPhases(makeCtx(makeAdapter(), tmp), "dev");

    expect(
      wranglerSecretPutCalls,
      "successful dev deploy must re-assert ACCESS_PIN from the declared accessPin (AC-7)",
    ).toHaveLength(1);
    expect(wranglerSecretPutCalls[0]).toMatchObject({
      workerName: "test-dev",
      secretName: "ACCESS_PIN",
      value: "4092",
    });
    expect(result.accessReconcile).toEqual({ ok: true });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  }
});

test("RFC-1284: reconcile is skipped while a suspension marker is open", async () => {
  const tmp = makeWorkspace();
  try {
    deploySystemState = {
      ...deploySystemState,
      accessPin: "4092",
      accessPinSuspended: {
        at: "2026-10-15T10:00:00.000Z",
        by: "leitstand.certify",
        operationId: null,
      },
    };
    const result = await executeDeployPhases(makeCtx(makeAdapter(), tmp), "dev");

    expect(wranglerSecretPutCalls).toHaveLength(0);
    expect(result.accessReconcile).toBeUndefined();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  }
});

test("RFC-1284: reconcile is skipped when accessPin is null (deliberately unprotected)", async () => {
  const tmp = makeWorkspace();
  try {
    const result = await executeDeployPhases(makeCtx(makeAdapter(), tmp), "dev");

    expect(wranglerSecretPutCalls).toHaveLength(0);
    expect(result.accessReconcile).toBeUndefined();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  }
});

test("RFC-1284: reconcile never runs on main — production is never protected", async () => {
  const tmp = makeWorkspace();
  try {
    deploySystemState = { ...deploySystemState, accessPin: "4092" };
    const result = await executeDeployPhases(makeCtx(makeAdapter(), tmp), "main");

    expect(wranglerSecretPutCalls).toHaveLength(0);
    expect(result.accessReconcile).toBeUndefined();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  }
});

test("RFC-1284: alt deploy reconciles ACCESS_PIN", async () => {
  const tmp = makeWorkspace();
  try {
    deploySystemState = { ...deploySystemState, accessPin: "4092" };
    const result = await executeDeployPhases(makeCtx(makeAdapter(), tmp), "alt");

    expect(wranglerSecretPutCalls).toHaveLength(1);
    expect(wranglerSecretPutCalls[0].workerName).toBe("test-alt");
    expect(result.accessReconcile).toEqual({ ok: true });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  }
});

test("RFC-1284: reconcile re-reads state AFTER propagation — a suspension opened mid-deploy is respected", async () => {
  const tmp = makeWorkspace();
  try {
    // Desired pin set, no suspension yet — a naive pre-deploy read would
    // re-assert the pin. Simulate a concurrent certify opening a suspension
    // while the adapter propagates.
    deploySystemState = { ...deploySystemState, accessPin: "4092" };
    const adapter = makeAdapter();
    const originalPropagate = adapter.propagate;
    adapter.propagate = async (input) => {
      const res = await originalPropagate.call(adapter, input);
      deploySystemState = {
        ...deploySystemState,
        accessPinSuspended: {
          at: new Date().toISOString(),
          by: "leitstand.certify",
          operationId: "op-concurrent",
        },
      };
      return res;
    };

    const result = await executeDeployPhases(makeCtx(adapter, tmp), "dev");

    expect(
      wranglerSecretPutCalls,
      "reconcile must read fresh state — the mid-deploy suspension suppresses the re-assert",
    ).toHaveLength(0);
    expect(result.accessReconcile).toBeUndefined();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  }
});

test("RFC-1284: reconcile failure is non-fatal — result records the diagnostic, deploy continues", async () => {
  const tmp = makeWorkspace();
  try {
    deploySystemState = { ...deploySystemState, accessPin: "4092" };
    wranglerSecretPutExitCode = 1;
    // Custom-domain dev channel runs the freshness gate — verify it passes so
    // the reconcile failure is the only diagnostic on the result.
    vi.mocked(verifyFreshness).mockResolvedValueOnce({
      verified: true,
      cdnDistTreeHash: "hash",
      localDistTreeHash: "hash",
      attempts: 1,
    });
    const result = await executeDeployPhases(makeCtx(makeAdapter(), tmp), "dev");

    expect(result.accessReconcile?.ok).toBe(false);
    expect(
      result.accessReconcile?.error,
      "reconcile failure must surface on the result — ACCESS-01 is the backstop",
    ).toBeDefined();
    // Non-fatal: the deploy itself still reports healthy phases.
    expect(result.effectRecord.state).toBe("succeeded");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  }
});
