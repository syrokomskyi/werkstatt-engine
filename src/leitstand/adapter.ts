/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/leitstand/adapter.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0358: initial deployment adapter interface.</item>
  <item>RFC-0379: channel model — replace target/credentials with channel/workerName/url/secretsFilePath; add CommandRunner type.</item>
  <item>RFC-0585: add nodeModulesBinPath to PropagateInput/RollbackInput for wrangler resolution from dist/server/.</item>
  <item>RFC-0587: add DeploymentLimits interface and getLimits() method for adapter-declared size limits.</item>
  <item>RFC-0627: extend channel type to include "dev" for the three-channel deployment chain.</item>
  <item>RFC-0926: add optional versionId to RollbackInput and rolledBackToVersionId to RollbackResult for release-aware rollback.</item>
</CHANGE_SUMMARY>
*/

import type { PropagationResult, HealthCheck } from "@warpgogol/werkstatt-engine/schemas";

export type CommandRunner = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string> },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export interface PropagateInput {
  systemId: string;
  releaseId: string;
  channel: "dev" | "alt" | "main";
  distPath: string;
  workerName: string;
  url: string;
  secretsFilePath: string | undefined;
  expectedBehaviorSnapshotHash: string;
  nodeModulesBinPath?: string;
}

export interface RollbackInput {
  systemId: string;
  channel: "dev" | "alt" | "main";
  wranglerConfigDir: string;
  workerName: string;
  versionId?: string;
}

export interface RollbackResult {
  systemId: string;
  channel: "dev" | "alt" | "main";
  state: "succeeded" | "failed";
  workerName: string;
  rolledBackToVersionId?: string;
  startedAt: string;
  completedAt: string;
  stdout: string;
  stderr: string;
}

export interface HealthInput {
  systemId: string;
  channel: "dev" | "alt" | "main";
  deploymentUrl: string;
  releaseId: string;
  expectedBehaviorSnapshotHash: string;
  workspaceRoot: string;
  authHeaders?: Record<string, string>;
}

export interface DeploymentLimits {
  maxTotalSize: number;
  maxFileSize: number;
}

export interface DeploymentAdapter {
  name: string;
  propagate(input: PropagateInput): Promise<PropagationResult>;
  rollback(input: RollbackInput): Promise<RollbackResult>;
  health(
    input: HealthInput,
  ): Promise<{ state: "healthy" | "unhealthy" | "unknown"; checks: HealthCheck[] }>;
  getLimits(): DeploymentLimits;
}
