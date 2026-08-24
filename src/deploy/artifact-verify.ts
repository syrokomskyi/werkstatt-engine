/*
<MODULE_CONTRACT>
  <purpose>RFC-0566 deploy.artifact.verify — verify artifact content hash and signature against manifest.</purpose>
  <keywords>deploy, artifact, verify, hash, signature</keywords>
  <responsibilities>
    <item>Recompute content hash of artifact dist/ directory.</item>
    <item>Compare against manifest hash.</item>
    <item>Verify Ed25519 signature on the manifest.</item>
  </responsibilities>
  <non-goals>
    <item>Do not swap symlinks — that is deploy.atomic.swap's job.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0566: initial deploy.artifact.verify handler.</item>
</CHANGE_SUMMARY>
*/

import { existsSync } from "node:fs";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { verifyJsonSignatureAsync, requireEnv } from "@warpgogol/werkstatt-engine/integrity";
import type { ArtifactVerifyResult } from "./types.ts";
import { artifactDir, distPath, hashArtifactDir, readManifest } from "./deploy-utils.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function runDeployArtifactVerify(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ArtifactVerifyResult>> {
  const { workspaceRoot, logger } = context;
  const hash = flagString(input, "hash");

  if (!hash) {
    throw new Error("[deploy.artifact.verify] --hash is required");
  }

  const dir = artifactDir(workspaceRoot, hash);
  if (!existsSync(dir)) {
    logger.error(`[deploy.artifact.verify] artifact ${hash} not found`);
    return {
      data: { verified: false, hash, expectedHash: hash, signatureVerified: false },
      exitCode: 1,
      summary: `[deploy.artifact.verify] artifact ${hash} not found`,
    };
  }

  const manifest = await readManifest(workspaceRoot, hash);
  const distDir = distPath(workspaceRoot, hash);

  if (!existsSync(distDir)) {
    logger.error(`[deploy.artifact.verify] dist directory missing for artifact ${hash}`);
    return {
      data: { verified: false, hash, expectedHash: manifest.hash, signatureVerified: false },
      exitCode: 1,
      summary: `[deploy.artifact.verify] dist directory missing for ${hash}`,
    };
  }

  const { treeHash } = await hashArtifactDir(distDir);
  const hashMatches = treeHash === manifest.hash;

  let signatureVerified = false;
  if (manifest.signature) {
    try {
      const publicKeyPem = await requireEnv("SIGNING_PUBLIC_KEY", workspaceRoot);
      const payload: Record<string, unknown> = {
        hash: manifest.hash,
        files: manifest.files,
        totalSize: manifest.totalSize,
        builtAt: manifest.builtAt,
        gitSha: manifest.gitSha,
        buildHost: manifest.buildHost,
      };
      signatureVerified = await verifyJsonSignatureAsync({
        payload,
        signatureHex: manifest.signature,
        publicKeyPem,
      });
    } catch {
      signatureVerified = false;
    }
  }

  const verified = hashMatches && (signatureVerified || !manifest.signature);

  if (!verified) {
    logger.error(
      `[deploy.artifact.verify] verification failed for ${hash} (hash: ${hashMatches}, sig: ${signatureVerified})`,
    );
    return {
      data: { verified: false, hash: treeHash, expectedHash: manifest.hash, signatureVerified },
      exitCode: 1,
      summary: `[deploy.artifact.verify] ${hash} verification failed (hash-mismatch)`,
    };
  }

  logger.success(`[deploy.artifact.verify] artifact ${hash} verified`);
  return {
    data: { verified: true, hash: treeHash, expectedHash: manifest.hash, signatureVerified },
    summary: `[deploy.artifact.verify] ${hash} verified (hash: ok, sig: ${signatureVerified})`,
    nextSteps: [
      {
        action: `Deploy the artifact: pnpm exec werkstatt run leitstand.dev-deploy --release <release-id>`,
        kind: "optional",
      },
    ],
  };
}
