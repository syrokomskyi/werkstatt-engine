/*
<MODULE_CONTRACT>
  <purpose>
Unit tests for deploy execution purge covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1092: initial tests for purgeCapable() adapter interface and pipeline behavior.</item>
  <item>REVIEW-CODE-2026-10-01-01: stub bootSmokeCapable() on makeAdapter (required DeploymentAdapter method).</item>
</CHANGE_SUMMARY>
*/

import { afterEach, beforeEach, test, expect, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { executeDeployPhases } from "../deploy-execution.ts";
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
import { createCloudflareWorkersAdapter } from "../adapters/cloudflare-workers.ts";
import { createGitHubPagesAdapter } from "../adapters/github-pages.ts";

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

// RFC-1138: executeDeployPhases runs dns.record.upsert via executeKernelCommand
// before propagate/purge — without a mock it fails in the temp workspace and
// short-circuits the result (failingPhase: "dns-upsert", purgeResult undefined).
vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelCommand: vi.fn().mockResolvedValue({ exitCode: 0, summary: "ok" }),
  };
});

function makeAdapter(purgeCapable: boolean): DeploymentAdapter {
  return {
    name: purgeCapable ? "cloudflare-workers" : "github-pages",
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
      return purgeCapable;
    },
    bootSmokeCapable() {
      return purgeCapable;
    },
  };
}

const systemConfig: DeploymentStaticConfig = {
  adapter: "cloudflare-workers",
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

function makeCtx(
  adapter: DeploymentAdapter,
  workspaceRoot: string,
  _channel: "dev" | "alt" | "main" = "dev",
): DeployExecutionContext {
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
  const tmp = mkdtempSync(join(tmpdir(), "leitstand-purge-test-"));
  rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  writeFileSync(join(tmp, "package.json"), JSON.stringify({ version: "1.0.0" }) + "\n");
  const distDir = join(tmp, "releases", "r000001", "dist", "client");
  mkdirSync(distDir, { recursive: true });
  return tmp;
}

// Kernel env leaks into vitest under `werkstatt run` (dotenv/config loads
// .env): SIGNING_PRIVATE_KEY(_PATH) activate the release-sign phase of
// executeDeployPhases, which fails in tmp fixtures and short-circuits before
// purge (purgeResult stays undefined). Pin them empty so tests always
// exercise the unsigned path.
beforeEach(() => {
  vi.stubEnv("SIGNING_PRIVATE_KEY", "");
  vi.stubEnv("SIGNING_PRIVATE_KEY_PATH", "");
  vi.stubEnv("PUBLIC_KEY_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// AC-3: DeploymentAdapter interface includes purgeCapable() returning boolean
test("AC-3: DeploymentAdapter interface includes purgeCapable() returning boolean", () => {
  const adapter = makeAdapter(true);
  expect(typeof adapter.purgeCapable).toBe("function");
  expect(typeof adapter.purgeCapable()).toBe("boolean");
});

// AC-4: cloudflare-workers adapter purgeCapable() returns true
test("AC-4: cloudflare-workers adapter purgeCapable() returns true", () => {
  const adapter = createCloudflareWorkersAdapter();
  expect(adapter.purgeCapable()).toBe(true);
});

// AC-5: github-pages adapter purgeCapable() returns false
test("AC-5: github-pages adapter purgeCapable() returns false", () => {
  const adapter = createGitHubPagesAdapter();
  expect(adapter.purgeCapable()).toBe(false);
});

// AC-1: When adapter purgeCapable() returns false, executeDeployPhases skips runPurgeStep
test("AC-1: adapter with purgeCapable()=false skips purge — purgeResult is undefined", async () => {
  const tmp = makeWorkspace();
  try {
    const adapter = makeAdapter(false);
    const result = await executeDeployPhases(makeCtx(adapter, tmp), "dev");
    expect(result.purgeResult).toBeUndefined();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  }
});

// AC-2: When adapter purgeCapable() returns true, executeDeployPhases calls runPurgeStep
test("AC-2: adapter with purgeCapable()=true calls purge — purgeResult is defined", async () => {
  const tmp = makeWorkspace();
  try {
    const adapter = makeAdapter(true);
    const ctx = makeCtx(adapter, tmp, "dev");
    ctx.systemConfig = {
      ...systemConfig,
      channels: {
        ...systemConfig.channels,
        dev: { workerName: "test-dev", url: "https://test-dev.example.com" },
      },
    };
    const result = await executeDeployPhases(ctx, "dev");
    expect(result.purgeResult).toBeDefined();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  }
});

// AC-6: When purge is skipped, verifyFreshness still runs
test("AC-6: verifyFreshness still runs when purge is skipped (purgeCapable()=false)", async () => {
  const tmp = makeWorkspace();
  try {
    const adapter = makeAdapter(false);
    const result = await executeDeployPhases(makeCtx(adapter, tmp), "dev");
    expect(result.purgeResult).toBeUndefined();
    expect(result.freshness).toBeDefined();
    expect(result.freshness.verified).toBeDefined();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(resolve(tmp, "..", "systems-cache"), { recursive: true, force: true });
  }
});
