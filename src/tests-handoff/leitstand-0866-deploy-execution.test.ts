/*
<MODULE_CONTRACT>
  <purpose>RFC-0866: executeDeployPhases runs the 13-phase deployment pipeline with channel-specific logic.</purpose>
  <keywords>RFC-0866, leitstand, deploy-execution, pipeline, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0866: initial test for executeDeployPhases with null adapter and dev channel.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
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
import type { PropagationResult, HealthCheck } from "@warpgogol/werkstatt-engine/schemas";
import type { AuthorizeResult } from "../leitstand/deploy-helpers.ts";
import type { DeploymentStaticConfig } from "@warpgogol/werkstatt-engine/schemas";
import type { Sha256Digest } from "../fingerprint/primitives.ts";

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
  const distDir = join(tmp, "releases", "r000001", "dist", "client");
  mkdirSync(distDir, { recursive: true });
  return tmp;
}

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
  }
});

test("executeDeployPhases returns deploymentUrl from channel config for alt", async () => {
  const tmp = makeWorkspace();
  try {
    const result = await executeDeployPhases(makeCtx("op-002", tmp), "alt");
    expect(result.deploymentUrl).toBe("https://alt.example.com");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("executeDeployPhases returns deploymentUrl from channel config for main", async () => {
  const tmp = makeWorkspace();
  try {
    const result = await executeDeployPhases(makeCtx("op-003", tmp), "main");
    expect(result.deploymentUrl).toBe("https://main.example.com");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
