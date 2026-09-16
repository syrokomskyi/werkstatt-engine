/*
<MODULE_CONTRACT>
  <purpose>deploy.status — report the current platform deployment status for the workspace (RFC-0566).</purpose>


  <non-goals>
    <item>Do not mutate symlinks or artifacts.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0566: initial deploy.status handler.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import { existsSync } from "node:fs";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import type { DeployStatus } from "./types.ts";
import {
  currentSymlinkPath,
  manifestPath,
  previousSymlinkPath,
  readSymlinkBasename,
} from "./deploy-utils.ts";
import fs from "node:fs/promises";

export async function runDeployStatus(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<DeployStatus>> {
  const { workspaceRoot, logger } = context;

  const currentHash = readSymlinkBasename(currentSymlinkPath(workspaceRoot));
  const previousHash = readSymlinkBasename(previousSymlinkPath(workspaceRoot));

  let currentGitSha: string | null = null;
  let deployedAt: string | null = null;

  if (currentHash) {
    const mp = manifestPath(workspaceRoot, currentHash);
    if (existsSync(mp)) {
      try {
        const manifest = JSON.parse(await fs.readFile(mp, "utf8"));
        currentGitSha = manifest.gitSha ?? null;
        deployedAt = manifest.builtAt ?? null;
      } catch {
        // corrupt manifest — leave null
      }
    }
  }

  const status: DeployStatus = {
    currentHash,
    previousHash,
    currentGitSha,
    deployedAt,
    workshops: [],
  };

  logger.info(
    `[deploy.status] current: ${currentHash ?? "none"}, previous: ${previousHash ?? "none"}`,
  );

  return {
    data: status,
    summary: `[deploy.status] current: ${currentHash?.slice(0, 16) ?? "none"}..., previous: ${previousHash?.slice(0, 16) ?? "none"}...`,
    nextSteps: [
      {
        action: `Check leitstand status: pnpm exec werkstatt run leitstand.status --site <system-id>`,
        kind: "optional",
      },
    ],
  };
}
