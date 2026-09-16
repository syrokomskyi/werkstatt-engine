/*
<MODULE_CONTRACT>
  <purpose>RFC-0566 deploy.atomic.rollback — atomic symlink swap back to the previous platform artifact.</purpose>


  <non-goals>
    <item>Do not rebuild from source — rollback swaps to existing previous symlink target.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0566: initial deploy.atomic.rollback handler.</item>
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
