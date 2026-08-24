/*
<MODULE_CONTRACT>
  <purpose>RFC-0566 deploy.status — report current platform deployment status.</purpose>
  <keywords>deploy, status, current, previous, git-sha</keywords>
  <responsibilities>
    <item>Read current and previous symlink targets.</item>
    <item>Read manifest.json for current git SHA and deployment time.</item>
    <item>Return DeployStatus with current/previous hashes and git SHA.</item>
  </responsibilities>
  <non-goals>
    <item>Do not mutate symlinks or artifacts.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0566: initial deploy.status handler.</item>
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
