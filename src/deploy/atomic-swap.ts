/*
<MODULE_CONTRACT>
  <purpose>RFC-0566 deploy.atomic.swap — atomic symlink swap to deploy a new platform artifact.</purpose>


  <non-goals>
    <item>Do not build artifacts — that is deploy.artifact.build's job.</item>
    <item>Do not implement two-phase commit — Phase 4 is deferred.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0566: initial deploy.atomic.swap handler with current+previous symlink management.</item>
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

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function runDeployAtomicSwap(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<AtomicSwapResult>> {
  const { workspaceRoot, logger } = context;
  const hash = flagString(input, "hash");

  if (!hash) {
    throw new Error("[deploy.atomic.swap] --hash is required");
  }

  const dir = artifactDir(workspaceRoot, hash);
  if (!existsSync(dir)) {
    throw new Error(`[deploy.atomic.swap] artifact ${hash} not found`);
  }

  const verifyResult = await runDeployArtifactVerify(
    { ...input, flags: { ...input.flags, hash } },
    context,
  );

  if (!verifyResult.data?.verified) {
    throw new Error(
      `[deploy.atomic.swap] artifact ${hash} hash verification failed (hash-mismatch)`,
    );
  }

  const currentPath = currentSymlinkPath(workspaceRoot);
  const previousPath = previousSymlinkPath(workspaceRoot);

  const oldCurrentHash = readSymlinkBasename(currentPath);
  const startTime = Date.now();

  if (oldCurrentHash && oldCurrentHash !== hash) {
    const oldArtifactDir = artifactDir(workspaceRoot, oldCurrentHash);
    await atomicSymlinkSwap(previousPath, oldArtifactDir);
  } else if (!oldCurrentHash) {
    logger.info("[deploy.atomic.swap] first deploy — no previous symlink to create");
  }

  await atomicSymlinkSwap(currentPath, dir);

  const swapTimeMs = Date.now() - startTime;

  logger.success(
    `[deploy.atomic.swap] swapped to ${hash} in ${swapTimeMs}ms` +
      (oldCurrentHash ? ` (previous: ${oldCurrentHash})` : ""),
  );

  return {
    data: {
      swapped: true,
      previousHash: oldCurrentHash,
      newHash: hash,
      swapTimeMs,
    },
    summary: `[deploy.atomic.swap] swapped to ${hash.slice(0, 16)}... in ${swapTimeMs}ms`,
    nextSteps: [
      {
        action: `Verify health: pnpm exec werkstatt run leitstand.health --site <system-id> --channel main`,
        kind: "optional",
      },
    ],
  };
}
