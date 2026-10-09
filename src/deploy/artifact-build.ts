/*
<MODULE_CONTRACT>
  <purpose>RFC-0566 deploy.artifact.build — build immutable platform artifact from local git clone.</purpose>


  <non-goals>
    <item>Do not deploy or swap symlinks — that is deploy.atomic.swap's job.</item>
    <item>Do not verify artifacts — that is deploy.artifact.verify's job.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0566: initial deploy.artifact.build handler.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { signJsonPayloadAsync, requireEnv } from "@warpgogol/werkstatt-engine/integrity";
import type { ArtifactBuildResult, ArtifactManifest } from "./types.ts";
import {
  artifactDir,
  hashArtifactDir,
  platformArtifactsBase,
  writeManifest,
} from "./deploy-utils.ts";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

function _flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

async function getGitSha(workspaceRoot: string, io: WorkspaceIO): Promise<string> {
  try {
    const output = (
      await io.exec("git", ["rev-parse", "HEAD"], {
        cwd: workspaceRoot,
        timeoutMs: 5000,
      })
    ).stdout.trim();
    return output;
  } catch {
    return "unknown";
  }
}

async function copyDistTrees(
  workspaceRoot: string,
  destDist: string,
  io: WorkspaceIO,
): Promise<void> {
  const packagesDir = path.join(workspaceRoot, "packages");
  if (!(await io.exists(packagesDir))) return;

  await io.mkdir(destDist);

  const entries = await io.readdir(packagesDir);
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const pkgDir = path.join(packagesDir, entry.name);
    const distDir = path.join(pkgDir, "dist");
    if (!(await io.exists(distDir))) continue;

    const destPkgDir = path.join(destDist, entry.name);
    await io.mkdir(destPkgDir);
    const cpResult = await io.exec("cp", ["-r", distDir, destPkgDir]);
    if (cpResult.exitCode !== 0) {
      throw new Error(`cp failed for '${entry.name}': ${cpResult.stderr.slice(0, 200)}`);
    }
  }
}

export async function runDeployArtifactBuild(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ArtifactBuildResult>> {
  const { workspaceRoot, logger } = context;
  const skipBuild = flagBool(input, "skip-build");
  const skipSign = flagBool(input, "skip-sign");

  const baseDir = platformArtifactsBase(workspaceRoot);
  await context.io.mkdir(baseDir);

  if (!skipBuild) {
    logger.info("[deploy.artifact.build] running turbo run build...");
    try {
      const buildResult = await context.io.exec("pnpm", ["exec", "turbo", "run", "build"], {
        cwd: workspaceRoot,
        timeoutMs: 300000,
      });
      if (buildResult.exitCode !== 0) {
        throw new Error(
          `turbo run build exited ${buildResult.exitCode}: ${buildResult.stderr.slice(-400)}`,
        );
      }
    } catch (err) {
      throw new Error(`[deploy.artifact.build] turbo run build failed: ${(err as Error).message}`);
    }
  }

  const stagingDir = path.join(baseDir, `.staging-${process.pid}-${Date.now()}`);
  const stagingDist = path.join(stagingDir, "dist");
  await context.io.mkdir(stagingDist);

  try {
    await copyDistTrees(workspaceRoot, stagingDist, context.io);

    const { treeHash, files, totalSize } = await hashArtifactDir(stagingDist);
    const hash = treeHash;

    const gitSha = await getGitSha(workspaceRoot, context.io);
    const builtAt = new Date().toISOString();
    const buildHost = await requireEnv("WORKSHOP_ID", workspaceRoot).catch(
      () => process.env.HOSTNAME ?? "unknown",
    );

    let manifest: ArtifactManifest = {
      hash,
      files,
      totalSize,
      builtAt,
      gitSha,
      buildHost,
      signature: "",
      signatureAlgorithm: "Ed25519",
    };

    if (!skipSign) {
      try {
        const privateKeyPem = await requireEnv("SIGNING_PRIVATE_KEY", workspaceRoot);
        const signed = await signJsonPayloadAsync(
          privateKeyPem,
          manifest as unknown as Record<string, unknown>,
        );
        manifest = { ...manifest, signature: signed.signatureHex };
      } catch (err) {
        logger.info(`[deploy.artifact.build] signing skipped: ${(err as Error).message}`);
      }
    }

    const finalDir = artifactDir(workspaceRoot, hash);
    if (await context.io.exists(finalDir)) {
      logger.info(`[deploy.artifact.build] artifact ${hash} already exists — reusing`);
      return {
        data: {
          hash,
          gitSha,
          builtAt,
          buildHost: manifest.buildHost,
          fileCount: files.length,
          totalSize,
          artifactPath: finalDir,
        },
        exitCode: 0,
        summary: `[deploy.artifact.build] artifact ${hash.slice(0, 16)}... (${files.length} files, ${totalSize} bytes)`,
        nextSteps: [
          {
            action: `Verify the artifact: pnpm exec werkstatt run deploy.artifact.verify --hash ${hash}`,
            kind: "optional",
          },
        ],
      };
    }

    await context.io.rename(stagingDir, finalDir);
    await writeManifest(workspaceRoot, hash, manifest);

    logger.success(
      `[deploy.artifact.build] artifact ${hash} created (${files.length} files, ${totalSize} bytes)`,
    );

    return {
      data: {
        hash,
        gitSha,
        builtAt,
        buildHost: manifest.buildHost,
        fileCount: files.length,
        totalSize,
        artifactPath: finalDir,
      },
      exitCode: 0,
      summary: `[deploy.artifact.build] artifact ${hash.slice(0, 16)}... (${files.length} files, ${totalSize} bytes)`,
      nextSteps: [
        {
          action: `Verify the artifact: pnpm exec werkstatt run deploy.artifact.verify --hash ${hash}`,
          kind: "optional",
        },
      ],
    };
  } finally {
    if (await context.io.exists(stagingDir)) {
      await context.io.rm(stagingDir, { recursive: true }).catch(() => {});
    }
  }
}
