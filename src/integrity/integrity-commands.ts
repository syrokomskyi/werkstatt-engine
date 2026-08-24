/*
<MODULE_CONTRACT>
<purpose>Facilitates integrity management commands for application builds, including initialization, updates, verification, and signing.</purpose>
<non-goals>
  <item>Do not handle raw content parsing or manipulation of build files.</item>
  <item>Do not manage application configuration or orchestration.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  buildLatestDir,
  compareManifestWithLocalArtifacts,
  ensureDir,
  generateSigningKeyPairPemAsync,
  loadPublicKeyPem,
  loadSignedManifest,
  optionalEnv,
  requireEnv,
  runBackfillRevisions,
  runInit,
  runRecordBuild,
  runUpdate,
  runVerify,
  signedManifestPath,
  signLatestBuildArtifacts,
  verifyManifestSignature,
  writeText,
} from "@warpgogol/werkstatt-engine/integrity";

function requireApp(context: KernelRuntimeContext) {
  if (!context.site) {
    throw new Error("This command requires an app-scoped runtime context.");
  }
  return context.site;
}

function getStringArg(
  input: KernelCommandInput,
  index: number,
  fallback?: string,
): string | undefined {
  return fallback;
}

export async function runIntegrityInit(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const app = requireApp(context);
  if (context.dryRun) {
    return { summary: `[integrity.init] dry-run: would initialize integrity for ${app.name}` };
  }

  await runInit({ cwd: app.directory });
  return {
    summary: `[integrity.init] complete for ${app.name}`,
    nextSteps: [
      {
        action: `Update integrity manifests: pnpm exec werkstatt run integrity.update`,
        kind: "optional",
      },
    ],
  };
}

export async function runIntegrityUpdate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const app = requireApp(context);
  if (context.dryRun) {
    return {
      summary: `[integrity.update] dry-run: would update integrity manifests for ${app.name}`,
    };
  }

  await runUpdate({ cwd: app.directory, baseRef: getStringArg(input, 0) });
  return {
    summary: `[integrity.update] complete for ${app.name}`,
    nextSteps: [
      { action: `Verify integrity: pnpm exec werkstatt run integrity.verify`, kind: "optional" },
    ],
  };
}

export async function runIntegrityVerify(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ ok: boolean }>> {
  const app = requireApp(context);
  const report = await runVerify({ cwd: app.directory });
  return {
    data: { ok: report.ok },
    exitCode: report.ok ? 0 : 1,
    summary: report.ok ? "Integrity verification passed." : undefined,
    nextSteps: report.ok
      ? undefined
      : [
          {
            action: `Fix the integrity violations above, then re-run: pnpm exec werkstatt run integrity.verify`,
            kind: "required",
          },
        ],
  };
}

export async function runIntegrityBuildRecord(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const app = requireApp(context);
  const distDir = getStringArg(input, 0, "dist") ?? "dist";
  if (context.dryRun) {
    return {
      summary: `[integrity.build-record] dry-run: would record build outputs from ${distDir}`,
    };
  }

  await runRecordBuild({ cwd: app.directory, builder: "local", distDir });
  return {
    summary: `[integrity.build-record] complete for ${app.name}`,
    nextSteps: [
      { action: `Sign the build: pnpm exec werkstatt run integrity.sign`, kind: "optional" },
    ],
  };
}

async function loadPrivateKeyPem(appDirectory: string): Promise<string> {
  const keyPath = await optionalEnv("SIGNING_PRIVATE_KEY_PATH", appDirectory);
  if (keyPath) {
    return fs.readFile(path.resolve(appDirectory, keyPath), "utf8");
  }

  const defaultKeyPath = path.join(appDirectory, ".integrity/keys/studio.private.pem");
  try {
    return await fs.readFile(defaultKeyPath, "utf8");
  } catch {
    // Fallback to env variable
  }

  return requireEnv("SIGNING_PRIVATE_KEY", appDirectory);
}

export async function runIntegritySign(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ reusedExistingSignature: boolean }>> {
  const app = requireApp(context);
  if (context.dryRun) {
    return { summary: `[integrity.sign] dry-run: would sign ${buildLatestDir(app.directory)}` };
  }

  const privateKeyPem = await loadPrivateKeyPem(app.directory);
  const publicKeyUrl = await optionalEnv("PUBLIC_KEY_URL", app.directory);
  const result = await signLatestBuildArtifacts({
    cwd: app.directory,
    privateKeyPem,
    publicKeyUrl,
  });

  context.logger.info(`Build directory: ${buildLatestDir(app.directory)}`);
  context.logger.info(
    `Public key URL: ${publicKeyUrl ?? "(embedded URL omitted for this signature)"}`,
  );
  context.logger.info(`Build ID: ${result.payload.buildId}`);
  context.logger.info(`Signed at: ${result.payload.signedAt}`);
  context.logger.info(`Outputs digest: ${result.payload.outputsDigest}`);
  context.logger.info(`Provenance digest: ${result.payload.provenanceDigest}`);
  context.logger.info(`Output files: ${Object.keys(result.outputs.outputs).length}`);
  context.logger.info(`Signature bytes: ${result.signatureBuffer.byteLength}`);
  context.logger.info(`Signature preview: ${result.signatureHex.slice(0, 32)}...`);
  context.logger.info(`Signed manifest: ${signedManifestPath(app.directory)}`);

  return {
    data: { reusedExistingSignature: result.reusedExistingSignature },
    summary: result.reusedExistingSignature
      ? "Release signature already matched the current build artifacts. Existing signed files were kept unchanged."
      : "Release signed successfully. Anyone holding your public key can verify this release independently.",
  };
}

export async function runIntegrityVerifyRelease(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ signatureValid: boolean }>> {
  const app = requireApp(context);
  const manifestSource =
    getStringArg(input, 0, signedManifestPath(app.directory)) ?? signedManifestPath(app.directory);
  const manifest = await loadSignedManifest(manifestSource);
  const publicKeyPemPath = await optionalEnv("PUBLIC_KEY_PEM_PATH", app.directory);
  const publicKeyUrl = await optionalEnv("PUBLIC_KEY_URL", app.directory);

  // Fallback to default public key location if no other source provided
  let resolvedKeyPath: string | undefined = publicKeyPemPath;
  if (!resolvedKeyPath && !publicKeyUrl && !manifest.publicKeyUrl) {
    const defaultPublicKeyPath = path.join(app.directory, "public/studio.public.pem");
    try {
      await fs.access(defaultPublicKeyPath);
      resolvedKeyPath = defaultPublicKeyPath;
    } catch {
      // No default key file, will fail below with proper error
    }
  }

  // Resolve relative paths against app.directory (loadPublicKeyPem uses path.resolve against process.cwd())
  if (resolvedKeyPath && !path.isAbsolute(resolvedKeyPath)) {
    resolvedKeyPath = path.resolve(app.directory, resolvedKeyPath);
  }

  const publicKeyPem = await loadPublicKeyPem({
    manifest,
    publicKeyPemPath: resolvedKeyPath,
    publicKeyUrl,
  });
  const signatureValid = await verifyManifestSignature({ manifest, publicKeyPem });

  context.logger.info(`Manifest source: ${manifestSource}`);
  context.logger.info(`Build ID: ${manifest.buildId}`);
  context.logger.info(`Signed at: ${manifest.signedAt}`);
  context.logger.info(`Algorithm: ${manifest.algorithm}`);
  context.logger.info(
    `Public key source: ${publicKeyPemPath ?? publicKeyUrl ?? manifest.publicKeyUrl ?? "(not provided)"}`,
  );
  context.logger.info(`Payload version: ${manifest.payloadVersion}`);
  context.logger.info(`Outputs digest: ${manifest.payload.outputsDigest}`);
  context.logger.info(`Provenance digest: ${manifest.payload.provenanceDigest}`);
  context.logger.info(`Result: ${signatureValid ? "VALID" : "INVALID"}`);

  let localCheckFailed = false;
  const localBuildDir = buildLatestDir(app.directory);
  if (
    !manifestSource.startsWith("https://") &&
    path.resolve(manifestSource).startsWith(path.resolve(localBuildDir))
  ) {
    const digestCheck = await compareManifestWithLocalArtifacts(app.directory, manifest);
    context.logger.info(`outputs.json: ${digestCheck.outputsDigestMatches ? "MATCH" : "MISMATCH"}`);
    context.logger.info(
      `build-provenance.json: ${digestCheck.provenanceDigestMatches ? "MATCH" : "MISMATCH"}`,
    );
    if (!digestCheck.outputsDigestMatches || !digestCheck.provenanceDigestMatches) {
      localCheckFailed = true;
    }
  }

  const ok = signatureValid && !localCheckFailed;
  return {
    data: { signatureValid },
    exitCode: ok ? 0 : 1,
    summary: ok
      ? "Release verified successfully. Anyone holding the public key can verify this release independently."
      : undefined,
  };
}

export async function runIntegrityGenerateSigningKeypair(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ privateKeyTarget: string; publicKeyTarget: string }>> {
  const app = requireApp(context);
  const privateKeyTarget = path.resolve(
    app.directory,
    getStringArg(input, 0, ".integrity/keys/studio.private.pem") ??
      ".integrity/keys/studio.private.pem",
  );
  const publicKeyTarget = path.resolve(
    app.directory,
    getStringArg(input, 1, "public/studio.public.pem") ?? "public/studio.public.pem",
  );

  if (context.dryRun) {
    return {
      data: { privateKeyTarget, publicKeyTarget },
      summary: `[integrity.keys.generate] dry-run: would write ${privateKeyTarget} and ${publicKeyTarget}`,
    };
  }

  const { privateKeyPem, publicKeyPem } = await generateSigningKeyPairPemAsync();
  await ensureDir(path.dirname(privateKeyTarget));
  await ensureDir(path.dirname(publicKeyTarget));
  await Promise.all([
    writeText(privateKeyTarget, privateKeyPem),
    writeText(publicKeyTarget, publicKeyPem),
  ]);

  context.logger.info(`Private key: ${privateKeyTarget}`);
  context.logger.info(`Public key: ${publicKeyTarget}`);
  return {
    data: { privateKeyTarget, publicKeyTarget },
    summary: "Ed25519 key pair generated.",
  };
}

export async function runIntegrityBackfillRevisions(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const app = requireApp(context);
  if (context.dryRun) {
    return {
      summary: `[integrity.backfill-revisions] dry-run: would update revision counters for ${app.name}`,
    };
  }

  await runBackfillRevisions({ cwd: app.directory });
  return { summary: `[integrity.backfill-revisions] complete for ${app.name}` };
}
