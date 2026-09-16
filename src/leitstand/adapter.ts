/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/leitstand/adapter.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0627: extend channel type to include "dev" for the three-channel deployment chain.</item>
  <item>RFC-0926: add optional versionId to RollbackInput and rolledBackToVersionId to RollbackResult for release-aware rollback.</item>
  <item>RFC-1092: add required purgeCapable() method to DeploymentAdapter for adapter-aware CDN purge.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <history>RFC-0358, RFC-0379, RFC-0585, RFC-0587</history>
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
  purgeCapable(): boolean;
}
