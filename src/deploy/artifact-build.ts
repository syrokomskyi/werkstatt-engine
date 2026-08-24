/*
<MODULE_CONTRACT>
  <purpose>RFC-0566 deploy.artifact.build — build immutable platform artifact from local git clone.</purpose>
  <keywords>deploy, artifact, build, turbo, platform</keywords>
  <responsibilities>
    <item>Run turbo run build to build all packages.</item>
    <item>Copy dist/ trees into content-addressed artifact directory.</item>
    <item>Compute SHA-256 content hash and write signed manifest.json.</item>
  </responsibilities>
  <non-goals>
    <item>Do not deploy or swap symlinks — that is deploy.atomic.swap's job.</item>
    <item>Do not verify artifacts — that is deploy.artifact.verify's job.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0566: initial deploy.artifact.build handler.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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

function _flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

async function getGitSha(workspaceRoot: string): Promise<string> {
  try {
    const output = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    return output;
  } catch {
    return "unknown";
  }
}

async function copyDistTrees(workspaceRoot: string, destDist: string): Promise<void> {
  const packagesDir = path.join(workspaceRoot, "packages");
  if (!existsSync(packagesDir)) return;

  await fs.mkdir(destDist, { recursive: true });

  const entries = await fs.readdir(packagesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgDir = path.join(packagesDir, entry.name);
    const distDir = path.join(pkgDir, "dist");
    if (!existsSync(distDir)) continue;

    const destPkgDir = path.join(destDist, entry.name);
    await fs.mkdir(destPkgDir, { recursive: true });
    await fs.cp(distDir, destPkgDir, { recursive: true });
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
  await fs.mkdir(baseDir, { recursive: true });

  if (!skipBuild) {
    logger.info("[deploy.artifact.build] running turbo run build...");
    try {
      execFileSync("pnpm", ["exec", "turbo", "run", "build"], {
        cwd: workspaceRoot,
        encoding: "utf8",
        timeout: 300000,
        stdio: "pipe",
      });
    } catch (err) {
      throw new Error(`[deploy.artifact.build] turbo run build failed: ${(err as Error).message}`);
    }
  }

  const stagingDir = path.join(baseDir, `.staging-${process.pid}-${Date.now()}`);
  const stagingDist = path.join(stagingDir, "dist");
  await fs.mkdir(stagingDist, { recursive: true });

  try {
    await copyDistTrees(workspaceRoot, stagingDist);

    const { treeHash, files, totalSize } = await hashArtifactDir(stagingDist);
    const hash = treeHash;

    const gitSha = await getGitSha(workspaceRoot);
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
    if (existsSync(finalDir)) {
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
        summary: `[deploy.artifact.build] artifact ${hash.slice(0, 16)}... (${files.length} files, ${totalSize} bytes)`,
        nextSteps: [
          {
            action: `Verify the artifact: pnpm exec werkstatt run deploy.artifact.verify --hash ${hash}`,
            kind: "optional",
          },
        ],
      };
    }

    await fs.rename(stagingDir, finalDir);
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
      summary: `[deploy.artifact.build] artifact ${hash.slice(0, 16)}... (${files.length} files, ${totalSize} bytes)`,
      nextSteps: [
        {
          action: `Verify the artifact: pnpm exec werkstatt run deploy.artifact.verify --hash ${hash}`,
          kind: "optional",
        },
      ],
    };
  } finally {
    if (existsSync(stagingDir)) {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
