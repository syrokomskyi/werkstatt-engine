/*
<MODULE_CONTRACT>
  <purpose>RFC-0566 deploy.atomic.rollback — atomic symlink swap back to the previous platform artifact.</purpose>
  <keywords>deploy, atomic, rollback, symlink, previous</keywords>
  <responsibilities>
    <item>Read previous symlink target to determine previous artifact hash.</item>
    <item>Fail with no-previous-artifact if no previous symlink exists.</item>
    <item>Verify previous artifact hash before swapping.</item>
    <item>Atomically swap current symlink back to previous artifact.</item>
  </responsibilities>
  <non-goals>
    <item>Do not rebuild from source — rollback swaps to existing previous symlink target.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0566: initial deploy.atomic.rollback handler.</item>
</CHANGE_SUMMARY>
*/

import { existsSync } from "node:fs";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import type { AtomicSwapResult } from "./types.ts";
import {
  artifactDir,
  atomicSymlinkSwap,
  currentSymlinkPath,
  previousSymlinkPath,
  readSymlinkBasename,
} from "./deploy-utils.ts";
import { runDeployArtifactVerify } from "./artifact-verify.ts";

export async function runDeployAtomicRollback(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<AtomicSwapResult>> {
  const { workspaceRoot, logger } = context;

  const previousPath = previousSymlinkPath(workspaceRoot);
  const previousHash = readSymlinkBasename(previousPath);

  if (!previousHash) {
    logger.error("[deploy.atomic.rollback] no previous artifact to roll back to");
    return {
      data: {
        swapped: false,
        previousHash: null,
        newHash: "",
        swapTimeMs: 0,
      },
      exitCode: 1,
      summary: "[deploy.atomic.rollback] no-previous-artifact",
    };
  }

  const dir = artifactDir(workspaceRoot, previousHash);
  if (!existsSync(dir)) {
    logger.error(`[deploy.atomic.rollback] previous artifact ${previousHash} directory missing`);
    return {
      data: {
        swapped: false,
        previousHash,
        newHash: "",
        swapTimeMs: 0,
      },
      exitCode: 1,
      summary: `[deploy.atomic.rollback] previous artifact ${previousHash} missing`,
    };
  }

  const verifyResult = await runDeployArtifactVerify(
    { ...input, flags: { ...input.flags, hash: previousHash } },
    context,
  );

  if (!verifyResult.data?.verified) {
    throw new Error(
      `[deploy.atomic.rollback] previous artifact ${previousHash} hash verification failed (hash-mismatch)`,
    );
  }

  const currentPath = currentSymlinkPath(workspaceRoot);
  const currentHash = readSymlinkBasename(currentPath);

  const startTime = Date.now();
  await atomicSymlinkSwap(currentPath, dir);
  const swapTimeMs = Date.now() - startTime;

  logger.success(
    `[deploy.atomic.rollback] rolled back to ${previousHash} in ${swapTimeMs}ms` +
      (currentHash ? ` (from ${currentHash})` : ""),
  );

  return {
    data: {
      swapped: true,
      previousHash: currentHash,
      newHash: previousHash,
      swapTimeMs,
    },
    summary: `[deploy.atomic.rollback] rolled back to ${previousHash.slice(0, 16)}... in ${swapTimeMs}ms`,
    nextSteps: [
      {
        action: `Verify health: pnpm exec werkstatt run leitstand.health --site <system-id> --channel main`,
        kind: "optional",
      },
    ],
  };
}
