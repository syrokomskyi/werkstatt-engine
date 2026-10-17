/*
<MODULE_CONTRACT>
  <purpose>RFC-0866: executeDeployPhases runs the 13-phase deployment pipeline with channel-specific logic.</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0866: initial test for executeDeployPhases with null adapter and dev channel.</item>
  <item>REVIEW-CODE-2026-10-01-01: stub bootSmokeCapable() on the test nullAdapter (required DeploymentAdapter method).</item>
  <item>RFC-1179: smoke-gate wiring tests — site.smoke.run/deploy.smoke.run invoked on every channel after health, non-zero exits map to failingPhase "site-smoke"/"deploy-smoke".</item>
</CHANGE_SUMMARY>
*/

import { afterEach, beforeEach, test, expect, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { executeDeployPhases } from "../leitstand/deploy-execution.ts";
import type { DeployExecutionContext } from "../leitstand/deploy-execution.ts";
import type {
  DeploymentAdapter,
  PropagateInput,
  RollbackInput,
  RollbackResult,
  HealthInput,
} from "../leitstand/adapter.ts";

vi.mock("../leitstand/leitstand-commands.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../leitstand/leitstand-commands.ts")>();
  return {
    ...actual,
    verifyFreshness: vi.fn().mockResolvedValue({
      verified: false,
      cdnDistTreeHash: null,
    }),
  };
});

// RFC-1138: executeDeployPhases runs dns.record.upsert via executeKernelCommand
// before propagate — without a mock it fails in the temp workspace and
// short-circuits the result (failingPhase: "dns-upsert").
vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelCommand: vi.fn().mockResolvedValue({ exitCode: 0, summary: "ok" }),
  };
});
import type { PropagationResult, HealthCheck } from "@warpgogol/werkstatt-engine/schemas";
import type { AuthorizeResult } from "../leitstand/deploy-helpers.ts";
import type { DeploymentStaticConfig } from "@warpgogol/werkstatt-engine/schemas";
import type { Sha256Digest } from "@warpgogol/werkstatt-shared/fingerprint";

const nullAdapter: DeploymentAdapter = {
  name: "null",
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

const systemConfig: DeploymentStaticConfig = {
  adapter: "null",
  channels: {
    dev: { workerName: "test-dev", url: "https://test-dev.workers.dev" },
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

function makeCtx(opId: string, workspaceRoot: string): DeployExecutionContext {
  return {
    systemId: "test-sys",
    releaseId: "r000001",
    candidateId: "test-sys",
    artifactHash: "sha256:abc" as Sha256Digest,
    authResult,
    workspaceRoot,
    cacheCloneDir: join(workspaceRoot, "..", "systems-cache", "test-sys"),
    systemConfig,
    adapter: nullAdapter,
    operationId: opId,
    gateDecisionPath: "/tmp/gd.json",
    secretsFilePath: undefined,
    skipEvidenceSync: true,
    forceBuild: false,
  };
}

function makeWorkspace(): string {
  const tmp = mkdtempSync(join(tmpdir(), "leitstand-test-"));
  // Clean up any stale systems-cache from previous test runs
  rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  writeFileSync(join(tmp, "package.json"), JSON.stringify({ version: "1.0.0" }) + "\n");
  const distDir = join(tmp, "releases", "r000001", "dist", "client");
  mkdirSync(distDir, { recursive: true });
  return tmp;
}

// Kernel env leaks into vitest under `werkstatt run` (dotenv/config loads
// .env): SIGNING_PRIVATE_KEY(_PATH) activate the release-sign phase of
// executeDeployPhases, which fails in tmp fixtures (failingPhase:
// "release-sign"). Pin them empty so tests always exercise the unsigned path.
beforeEach(() => {
  vi.stubEnv("SIGNING_PRIVATE_KEY", "");
  vi.stubEnv("SIGNING_PRIVATE_KEY_PATH", "");
  vi.stubEnv("PUBLIC_KEY_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("executeDeployPhases returns deploymentUrl from channel config for dev", async () => {
  const tmp = makeWorkspace();
  try {
    const result = await executeDeployPhases(makeCtx("op-001", tmp), "dev");
    expect(result.deploymentUrl).toBe("https://test-dev.workers.dev");
    expect(result.failingPhase).toBeUndefined();
    expect(result.freshness).toBeDefined();
    expect(result.healthState).toBe("healthy");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  }
});

test("executeDeployPhases returns deploymentUrl from channel config for alt", async () => {
  const tmp = makeWorkspace();
  try {
    const result = await executeDeployPhases(makeCtx("op-002", tmp), "alt");
    expect(result.deploymentUrl).toBe("https://alt.example.com");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  }
});

test("executeDeployPhases returns deploymentUrl from channel config for main", async () => {
  const tmp = makeWorkspace();
  try {
    const result = await executeDeployPhases(makeCtx("op-003", tmp), "main");
    expect(result.deploymentUrl).toBe("https://main.example.com");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  }
});

// RFC-1179: smoke-gate wiring — the executeKernelCommand mock at module top
// resolves { exitCode: 0 }; these tests override it per-case. verifyFreshness
// must resolve verified or alt/main never reach the smoke gates.

async function getKernelMock() {
  const kernel = await import("@warpgogol/werkstatt-engine/kernel");
  return vi.mocked(kernel.executeKernelCommand);
}

function mockReport(exitCode: number, summary: string) {
  return {
    commandName: "mock",
    exitCode,
    ok: exitCode === 0,
    summary,
    metadata: {} as never,
    logs: [],
    timing: { durationMs: 0, exceededTimeout: false },
  };
}

async function mockFreshnessVerified() {
  const commands = await import("../leitstand/leitstand-commands.ts");
  vi.mocked(commands.verifyFreshness).mockResolvedValue({
    verified: true,
    cdnDistTreeHash: null,
    localDistTreeHash: "",
    attempts: 1,
  });
}

test("executeDeployPhases invokes site.smoke.run and deploy.smoke.run after health on every channel", async () => {
  const tmp = makeWorkspace();
  try {
    await mockFreshnessVerified();
    const mock = await getKernelMock();
    for (const channel of ["dev", "alt", "main"] as const) {
      mock.mockClear();
      const result = await executeDeployPhases(makeCtx(`op-smoke-${channel}`, tmp), channel);
      expect(result.failingPhase).toBeUndefined();
      const names = mock.mock.calls.map((c) => (c[0] as { commandName: string }).commandName);
      expect(names).toContain("site.smoke.run");
      expect(names).toContain("deploy.smoke.run");
      expect(names.indexOf("site.smoke.run")).toBeLessThan(names.indexOf("deploy.smoke.run"));
      const smokeCall = mock.mock.calls.find(
        (c) => (c[0] as { commandName: string }).commandName === "deploy.smoke.run",
      );
      const argv = (smokeCall?.[0] as { argv: string[] }).argv;
      expect(argv).toContain("--site=test-sys");
      expect(argv).toContain("--release-id=r000001");
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  }
});

test("executeDeployPhases marks failingPhase site-smoke when site.smoke.run exits non-zero", async () => {
  const tmp = makeWorkspace();
  try {
    await mockFreshnessVerified();
    const mock = await getKernelMock();
    mock.mockClear();
    mock.mockImplementation(async (input) => {
      const { commandName } = input as { commandName: string };
      return commandName === "site.smoke.run"
        ? mockReport(1, "2 check(s) failed")
        : mockReport(0, "ok");
    });
    const result = await executeDeployPhases(makeCtx("op-smoke-fail", tmp), "alt");
    expect(result.failingPhase).toBe("site-smoke");
    // deploy.smoke.run must not run when site.smoke.run already blocked.
    const names = mock.mock.calls.map((c) => (c[0] as { commandName: string }).commandName);
    expect(names).not.toContain("deploy.smoke.run");
  } finally {
    const mock = await getKernelMock();
    mock.mockResolvedValue(mockReport(0, "ok"));
    rmSync(tmp, { recursive: true, force: true });
    rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  }
});

test("executeDeployPhases marks failingPhase deploy-smoke when deploy.smoke.run exits non-zero", async () => {
  const tmp = makeWorkspace();
  try {
    const mock = await getKernelMock();
    mock.mockClear();
    mock.mockImplementation(async (input) => {
      const { commandName } = input as { commandName: string };
      return commandName === "deploy.smoke.run"
        ? mockReport(1, "console error on /")
        : mockReport(0, "ok");
    });
    const result = await executeDeployPhases(makeCtx("op-smoke-fail2", tmp), "dev");
    expect(result.failingPhase).toBe("deploy-smoke");
  } finally {
    const mock = await getKernelMock();
    mock.mockResolvedValue(mockReport(0, "ok"));
    rmSync(tmp, { recursive: true, force: true });
    rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  }
});
