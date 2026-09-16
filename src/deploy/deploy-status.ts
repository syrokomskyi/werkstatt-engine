/*
<MODULE_CONTRACT>
  <purpose>RFC-0566 deploy.status — report current platform deployment status.</purpose>


  <non-goals>
    <item>Do not mutate symlinks or artifacts.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0566: initial deploy.status handler.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
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
