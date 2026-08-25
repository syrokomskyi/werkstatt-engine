/*
<MODULE_CONTRACT>
<purpose>RFC-0866: Shared 13-phase deploy execution pipeline for dev/alt/main channels. Runs after authorizeAndDeploy() returns ok: true.</purpose>
<non-goals>
  <item>Does not perform authorization — that is the responsibility of deploy-helpers.ts.</item>
  <item>Does not define the DeploymentAdapter interface — that lives in adapter.ts.</item>
  <item>Does not register commands — that lives in leitstand.module.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
<item>RFC-0866: initial deploy-execution module with DeployExecutionContext, DeployExecutionResult, and executeDeployPhases().</item>
<item>RFC-0866: implement full 13-phase executeDeployPhases function with channel-specific behavior.</item>
<item>RFC-0866 fix: populate HealthInput.releaseId and workspaceRoot from ctx, PropagateInput.expectedBehaviorSnapshotHash from localDistTreeHash.</item>
<item>RFC-0866 fix: capture error message in outer catch and add errorMessage to DeployExecutionResult.</item>
<item>RFC-0925: read accessPin from system-state.yaml, build authHeaders, pass to verifyFreshness and health checks for access-protected staging channels.</item>
<item>RFC-0931: insert signing phase between build-identity write and wrangler-deploy; add releaseSignResult to DeployExecutionResult.</item>
<item>RFC-0948: add post-deploy feature smoke check — fetches a page from the deployed URL and checks for feature markers in HTML. Non-fatal, warnings only.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import type { DeploymentAdapter, PropagateInput, HealthInput } from "./adapter.ts";
import type {
  DeploymentStaticConfig,
  DeploymentChannel,
  PurgeResult,
  HealthCheck,
  PropagationResult,
} from "@warpgogol/werkstatt-engine/schemas";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import {
  verifyFreshness,
  runMissionCheckWithResilience,
  type FreshnessResult,
} from "./leitstand-commands.ts";
import type { AuthorizeOutcome } from "./deploy-helpers.ts";
import type { DeploymentEffectRecordV1 } from "../certification/deployment/authority.ts";
import { buildEffectRecord, writeDeploymentEffectRecord } from "./deploy-helpers.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import { writeSystemStateSmart, readSystemStateSmart } from "../sternsystem/registry-io.ts";
import { collectPurgeUrls, purgeCacheByUrls, skippedPurgeResult } from "./cache-purge.ts";
import { readBehaviorSnapshot, sourceDotenv, filterEnv } from "./adapters/index.ts";
import { fingerprintTree } from "@warpgogol/werkstatt-engine/fingerprint/semantic";
import { atomicWriteFile } from "../werkstatt/atomic.ts";
import {
  signBuildIdentity,
  writeReleasePublicKey,
  signLatestBuildArtifacts,
} from "../integrity/signing.ts";
import { loadPrivateKey } from "@warpgogol/werkstatt-engine/signing";

const noopLogger = {
  info: (_m: string) => {},
  warn: (_m: string) => {},
  success: (_m: string) => {},
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildAuthHeader(pin: string | null | undefined): Record<string, string> {
  if (!pin) return {};
  const credentials = btoa(`warp:${pin}`);
  return { Authorization: `Basic ${credentials}` };
}

const HEALTH_CHECK_MAX_ATTEMPTS = 3;
const HEALTH_CHECK_BACKOFF_DELAYS_MS = [3_000, 6_000];

export interface DeployExecutionContext {
  systemId: string;
  releaseId: string | undefined;
  candidateId: string;
  artifactHash: Sha256Digest;
  authResult: AuthorizeOutcome;
  workspaceRoot: string;
  cacheCloneDir: string;
  systemConfig: DeploymentStaticConfig;
  adapter: DeploymentAdapter;
  operationId: string;
  missionId?: string;
  commitSha?: string;
  gateDecisionPath: string;
  secretsFilePath?: string;
  skipEvidenceSync?: boolean;
  forceBuild?: boolean;
}

export interface FeatureSmokeCheckResult {
  checked: boolean;
  markersFound: string[];
  markersMissing: string[];
  error: string | null;
}

export interface DeployExecutionResult {
  deploymentUrl: string;
  buildSkipped: boolean;
  buildIdentity: { releaseId: string; written: boolean; path: string };
  releaseSignResult?: {
    buildIdentitySigned: boolean;
    signatureHex: string | null;
    publicKeyUrl: string | null;
    reusedExistingSignature: boolean;
  };
  freshness: FreshnessResult;
  purgeResult?: PurgeResult;
  healthState: "healthy" | "unhealthy" | "unknown";
  healthChecks: HealthCheck[];
  featureSmokeCheck?: FeatureSmokeCheckResult;
  effectRecord: DeploymentEffectRecordV1;
  bordbuchCommitted: boolean;
  systemStateUpdated: boolean;
  evidenceSynced: boolean;
  evidenceSyncError: string | null;
  failingPhase?: string;
  errorMessage?: string;
}

function getChannelConfig(
  dep: DeploymentStaticConfig,
  channel: "dev" | "alt" | "main",
): DeploymentChannel {
  const channelConfig =
    channel === "dev" ? dep.channels.dev : channel === "alt" ? dep.channels.alt : dep.channels.main;
  if (!channelConfig) {
    throw new Error(`[executeDeployPhases] channel '${channel}' is not defined for system`);
  }
  return channelConfig;
}

function isDevWorkersUrl(url: string): boolean {
  return url.includes(".workers.dev");
}

async function runPurgeStep(
  workspaceRoot: string,
  releaseId: string,
  deploymentUrl: string,
  secretsFilePath: string | undefined,
): Promise<PurgeResult> {
  const secretsEnv = secretsFilePath ? await sourceDotenv(secretsFilePath) : {};
  const env = { ...filterEnv(process.env), ...secretsEnv };
  const zoneId = env["CLOUDFLARE_ZONE_ID"];
  const apiToken = env["CLOUDFLARE_API_TOKEN"];
  if (!zoneId) return skippedPurgeResult("CLOUDFLARE_ZONE_ID not set");
  if (!apiToken) return skippedPurgeResult("CLOUDFLARE_API_TOKEN not set");
  const snapshot = await readBehaviorSnapshot(workspaceRoot, releaseId);
  const routes = snapshot?.routes ?? [];
  const urls = collectPurgeUrls(deploymentUrl, routes);
  return purgeCacheByUrls(zoneId, apiToken, urls);
}

const FEATURE_SMOKE_MARKERS = ['externalLinkQrEntitled":true', "data-external-link-qr-modal"];

async function runFeatureSmokeCheck(
  deploymentUrl: string,
  authHeaders: Record<string, string>,
  workspaceRoot: string,
  releaseId: string | undefined,
): Promise<FeatureSmokeCheckResult> {
  try {
    let smokePath = "/";
    if (releaseId) {
      try {
        const snapshot = await readBehaviorSnapshot(workspaceRoot, releaseId);
        const routes = snapshot?.routes ?? [];
        const firstHtmlRoute = routes.find((r) => r.path && r.path !== "/" && !r.redirectTarget);
        if (firstHtmlRoute?.path) {
          smokePath = firstHtmlRoute.path;
        }
      } catch {
        // Non-fatal — fall back to "/"
      }
    }
    const base = deploymentUrl.replace(/\/$/, "");
    const fetchUrl = `${base}${smokePath}`;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      timer = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(fetchUrl, {
        headers: authHeaders,
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          checked: false,
          markersFound: [],
          markersMissing: [],
          error: `HTTP ${response.status} fetching ${fetchUrl}`,
        };
      }
      const html = await response.text();
      const markersFound: string[] = [];
      const markersMissing: string[] = [];
      for (const marker of FEATURE_SMOKE_MARKERS) {
        if (html.includes(marker)) {
          markersFound.push(marker);
        } else {
          markersMissing.push(marker);
        }
      }
      return { checked: true, markersFound, markersMissing, error: null };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (err) {
    return {
      checked: false,
      markersFound: [],
      markersMissing: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runHealthCheckWithRetry(
  adapter: DeploymentAdapter,
  systemId: string,
  deploymentUrl: string,
  channel: "dev" | "alt" | "main",
  releaseId: string,
  workspaceRoot: string,
  authHeaders: Record<string, string> = {},
): Promise<{ state: "healthy" | "unhealthy" | "unknown"; checks: HealthCheck[] }> {
  for (let attempt = 1; attempt <= HEALTH_CHECK_MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      await sleep(HEALTH_CHECK_BACKOFF_DELAYS_MS[attempt - 2]);
    }
    try {
      const healthInput: HealthInput = {
        systemId,
        deploymentUrl,
        channel,
        releaseId,
        expectedBehaviorSnapshotHash: "",
        workspaceRoot,
        authHeaders,
      };
      const result = await adapter.health(healthInput);
      if (result.state === "healthy") {
        return { state: "healthy", checks: result.checks ?? [] };
      }
      if (attempt === HEALTH_CHECK_MAX_ATTEMPTS) {
        return { state: result.state ?? "unhealthy", checks: result.checks ?? [] };
      }
    } catch {
      if (attempt === HEALTH_CHECK_MAX_ATTEMPTS) {
        return { state: "unhealthy", checks: [] };
      }
    }
  }
  return { state: "unknown", checks: [] };
}

export async function executeDeployPhases(
  ctx: DeployExecutionContext,
  channel: "dev" | "alt" | "main",
): Promise<DeployExecutionResult> {
  const channelConfig = getChannelConfig(ctx.systemConfig, channel);
  const deploymentUrl = channelConfig.url ?? "";
  const now = new Date().toISOString();

  const systemState = await readSystemStateSmart(ctx.workspaceRoot, ctx.systemId);
  const authHeaders = buildAuthHeader(systemState.accessPin);

  let buildSkipped = false;
  let buildIdentityPath = "";
  let localDistTreeHash = "";
  let purgeResult: PurgeResult | undefined;
  let freshness: FreshnessResult = {
    verified: false,
    cdnDistTreeHash: null,
    localDistTreeHash: "",
    attempts: 0,
  };
  let healthState: "healthy" | "unhealthy" | "unknown" = "unknown";
  let healthChecks: HealthCheck[] = [];
  let evidenceSynced = false;
  let evidenceSyncError: string | null = null;
  let bordbuchCommitted = false;
  let systemStateUpdated = false;
  let failingPhase: string | undefined;
  let releaseSignResult: DeployExecutionResult["releaseSignResult"];
  let featureSmokeCheck: FeatureSmokeCheckResult | undefined;

  const gate =
    channel === "dev" ? "dev-deploy" : channel === "alt" ? "propagate-alt" : "promote-main";

  const _effectRecord = buildEffectRecord(
    ctx.operationId,
    ctx.candidateId,
    gate,
    channel,
    ctx.artifactHash,
    ctx.authResult.ok ? ctx.authResult.outcome.decisionId : "",
    false,
    null,
    "deploying",
    now,
  );

  try {
    if (ctx.releaseId) {
      const releaseDir = path.join(ctx.workspaceRoot, "releases", ctx.releaseId);
      const distDir = path.join(releaseDir, "dist");
      if (!existsSync(distDir)) {
        try {
          execSync("pnpm build", {
            cwd: ctx.workspaceRoot,
            stdio: "pipe",
            timeout: 600000,
          });
        } catch (err) {
          failingPhase = "build";
          throw new Error(`Build failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        buildSkipped = true;
      }

      buildIdentityPath = path.join(distDir, "client", ".well-known", "build-identity.json");
      try {
        if (existsSync(buildIdentityPath)) {
          const existing = JSON.parse(await fs.readFile(buildIdentityPath, "utf8"));
          localDistTreeHash = existing.distTreeHash ?? "";
        }
        if (!localDistTreeHash) {
          const distTreeHashResult = await fingerprintTree(path.join(distDir, "client"), {
            mode: "stable",
          });
          localDistTreeHash = distTreeHashResult.value;
          const identity = {
            releaseId: ctx.releaseId,
            distTreeHash: localDistTreeHash,
            buildTimestamp: now,
          };
          await atomicWriteFile(buildIdentityPath, JSON.stringify(identity, null, 2));
        }
      } catch {
        // Non-fatal — build-identity is best-effort
      }
    }

    // --- RFC-0931: Signing phase (non-fatal if no key configured) ---
    if (ctx.releaseId && buildIdentityPath && existsSync(buildIdentityPath)) {
      try {
        const secretsEnv = ctx.secretsFilePath ? await sourceDotenv(ctx.secretsFilePath) : {};
        const signEnv = { ...filterEnv(process.env), ...secretsEnv };
        const privateKeyEnv = signEnv["SIGNING_PRIVATE_KEY"];
        const privateKeyPath = signEnv["SIGNING_PRIVATE_KEY_PATH"];
        const publicKeyUrl = signEnv["PUBLIC_KEY_URL"];

        if (privateKeyEnv || privateKeyPath) {
          let privateKeyBytes: Uint8Array;
          let privateKeyPem: string;
          try {
            if (privateKeyEnv) {
              privateKeyPem = privateKeyEnv;
              privateKeyBytes = await loadPrivateKey({ pem: privateKeyEnv });
            } else {
              privateKeyPem = await fs.readFile(privateKeyPath!, "utf8");
              privateKeyBytes = await loadPrivateKey({
                filePath: privateKeyPath!,
                encoding: "pem",
              });
            }
          } catch (err) {
            failingPhase = "release-sign";
            throw new Error(
              `Release signing failed (key load): ${err instanceof Error ? err.message : String(err)}`,
            );
          }

          const distDir = path.join(ctx.workspaceRoot, "releases", ctx.releaseId, "dist");
          const signResult = await signBuildIdentity({
            buildIdentityPath,
            privateKeyBytes,
            publicKeyUrl,
          });

          await writeReleasePublicKey({
            distDir,
            publicKeyHex: signResult.publicKeyHex,
          });

          try {
            await signLatestBuildArtifacts({
              cwd: ctx.cacheCloneDir,
              privateKeyPem,
              publicKeyUrl,
            });
          } catch {
            // Non-fatal: signed-manifest.json is best-effort in deploy pipeline
          }

          releaseSignResult = {
            buildIdentitySigned: true,
            signatureHex: signResult.signatureHex,
            publicKeyUrl: signResult.publicKeyUrl,
            reusedExistingSignature: signResult.reusedExistingSignature,
          };
        }
      } catch (err) {
        failingPhase = "release-sign";
        throw new Error(
          `Release signing failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const distPath = ctx.releaseId
      ? path.join(ctx.workspaceRoot, "releases", ctx.releaseId, "dist")
      : "";
    const propagateInput: PropagateInput = {
      systemId: ctx.systemId,
      releaseId: ctx.releaseId ?? "",
      url: deploymentUrl,
      channel,
      distPath,
      workerName: channelConfig.workerName,
      secretsFilePath: ctx.secretsFilePath,
      expectedBehaviorSnapshotHash: localDistTreeHash || "",
    };
    let propagateResult: PropagationResult;
    try {
      propagateResult = await ctx.adapter.propagate(propagateInput);
    } catch (err) {
      failingPhase = "wrangler-deploy";
      throw new Error(
        `Wrangler deploy failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const actualDeploymentUrl = propagateResult.deploymentUrl || deploymentUrl;

    if (channel !== "dev" || !isDevWorkersUrl(actualDeploymentUrl)) {
      try {
        purgeResult = await runPurgeStep(
          ctx.workspaceRoot,
          ctx.releaseId ?? "",
          actualDeploymentUrl,
          ctx.secretsFilePath,
        );
        if (channel !== "dev" && !purgeResult.success) {
          failingPhase = "cache-purge";
          throw new Error(`CDN cache purge failed: ${purgeResult.error ?? "unknown"}`);
        }
      } catch (err) {
        if (channel !== "dev") throw err;
        // Dev channel: purge failure is non-fatal
      }
    }

    if (channel !== "dev" || !isDevWorkersUrl(actualDeploymentUrl)) {
      if (localDistTreeHash) {
        freshness = await verifyFreshness(
          actualDeploymentUrl,
          localDistTreeHash,
          noopLogger,
          authHeaders,
        );
        if (!freshness.verified) {
          failingPhase = "freshness";
          throw new Error(`Freshness verification failed: ${freshness.error ?? "unknown"}`);
        }
      }
    }

    const healthResult = await runHealthCheckWithRetry(
      ctx.adapter,
      ctx.systemId,
      actualDeploymentUrl,
      channel,
      ctx.releaseId ?? "",
      ctx.workspaceRoot,
      authHeaders,
    );
    healthState = healthResult.state;
    healthChecks = healthResult.checks;
    if (healthState === "unhealthy") {
      failingPhase = "health-check";
      throw new Error("Health check failed — deployment is unhealthy");
    }

    // RFC-0948: Post-deploy feature smoke check — non-fatal warning
    if (channel !== "dev" || !isDevWorkersUrl(actualDeploymentUrl)) {
      featureSmokeCheck = await runFeatureSmokeCheck(
        actualDeploymentUrl,
        authHeaders,
        ctx.workspaceRoot,
        ctx.releaseId,
      );
    }

    if (channel === "dev" && ctx.missionId && ctx.commitSha) {
      try {
        const missionResult = await runMissionCheckWithResilience(
          ctx.workspaceRoot,
          ctx.missionId,
          actualDeploymentUrl,
          ctx.commitSha,
          noopLogger,
        );
        if (missionResult.exitCode === 1) {
          failingPhase = "mission-check";
          throw new Error("mission.check failed with content violations (exit 1)");
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes("mission.check")) {
          throw err;
        }
        // Infrastructure error — non-fatal for pipeline, logged
      }
    }

    if (channel === "alt" && ctx.missionId && ctx.commitSha) {
      try {
        const evidenceDir = path.join(
          ctx.workspaceRoot,
          "missions",
          ctx.missionId,
          "workpiece",
          "evidence",
        );
        const metadataPath = path.join(evidenceDir, "evidence-metadata.json");
        const studyRunPath = path.join(evidenceDir, "study-run.json");
        if (existsSync(metadataPath) && existsSync(studyRunPath)) {
          const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
          const studyRun = JSON.parse(await fs.readFile(studyRunPath, "utf8"));
          if (metadata.commitSha !== ctx.commitSha || studyRun.missionId !== ctx.missionId) {
            failingPhase = "axiom-evidence-gate";
            throw new Error(
              `Axiom evidence gate: commitSha or missionId mismatch (expected sha=${ctx.commitSha}, mission=${ctx.missionId})`,
            );
          }
        }
      } catch (err) {
        if (failingPhase === "axiom-evidence-gate") throw err;
        // Non-fatal — evidence files may not exist
      }
    }

    if (channel === "main") {
      const altChannelConfig = getChannelConfig(ctx.systemConfig, "alt");
      const altUrl = altChannelConfig.url ?? "";
      if (altUrl) {
        const altHealth = await runHealthCheckWithRetry(
          ctx.adapter,
          ctx.systemId,
          altUrl,
          "alt",
          ctx.releaseId ?? "",
          ctx.workspaceRoot,
          authHeaders,
        );
        if (altHealth.state !== "healthy") {
          failingPhase = "alt-health-check";
          throw new Error(
            `Alt channel is not healthy (state=${altHealth.state}) — cannot promote to main`,
          );
        }
      }
    }

    if (!ctx.skipEvidenceSync && ctx.missionId) {
      try {
        const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
        await executeKernelCommand({
          workspaceRoot: ctx.workspaceRoot,
          commandName: "evidence.sync",
          argv: [`--site=${ctx.systemId}`, `--mission=${ctx.missionId}`],
        });
        evidenceSynced = true;
      } catch (err) {
        evidenceSyncError = err instanceof Error ? err.message : String(err);
      }
    }

    try {
      await appendAndCommitBordbuch(
        ctx.workspaceRoot,
        ctx.systemId,
        "deployment",
        `${gate} deployed to ${channel}`,
        "leitstand",
      );
      bordbuchCommitted = true;
    } catch {
      // Non-fatal
    }

    try {
      const state = await readSystemStateSmart(ctx.workspaceRoot, ctx.systemId);
      if (state) {
        const channelKey = channel as "dev" | "alt" | "main";
        if (!state.lastPropagated) state.lastPropagated = {} as never;
        (state.lastPropagated as Record<string, unknown>)[channelKey] = {
          releaseId: ctx.releaseId ?? "",
          at: now,
          healthy: true,
          state: "succeeded",
          operationId: ctx.operationId,
          leaseExpiresAt: null,
          workerVersionId: propagateResult.workerVersionId,
        };
        await writeSystemStateSmart(ctx.workspaceRoot, ctx.systemId, state);
        systemStateUpdated = true;
      }
    } catch {
      // Non-fatal
    }

    const finalEffectRecord = buildEffectRecord(
      ctx.operationId,
      ctx.candidateId,
      gate,
      channel,
      ctx.artifactHash,
      ctx.authResult.ok ? ctx.authResult.outcome.decisionId : "",
      false,
      null,
      "succeeded",
      now,
      propagateResult.workerVersionId,
      ctx.releaseId ?? undefined,
    );
    await writeDeploymentEffectRecord(
      ctx.cacheCloneDir,
      finalEffectRecord,
      actualDeploymentUrl,
      propagateResult.workerVersionId,
      ctx.releaseId ?? undefined,
    );

    return {
      deploymentUrl: actualDeploymentUrl,
      buildSkipped,
      buildIdentity: {
        releaseId: ctx.releaseId ?? "",
        written: existsSync(buildIdentityPath),
        path: buildIdentityPath,
      },
      releaseSignResult,
      freshness,
      purgeResult,
      healthState,
      healthChecks,
      featureSmokeCheck,
      effectRecord: finalEffectRecord,
      bordbuchCommitted,
      systemStateUpdated,
      evidenceSynced,
      evidenceSyncError,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const failedEffectRecord = buildEffectRecord(
      ctx.operationId,
      ctx.candidateId,
      gate,
      channel,
      ctx.artifactHash,
      ctx.authResult.ok ? ctx.authResult.outcome.decisionId : "",
      false,
      null,
      "failed",
      now,
    );
    await writeDeploymentEffectRecord(ctx.cacheCloneDir, failedEffectRecord, deploymentUrl);

    return {
      deploymentUrl,
      buildSkipped,
      buildIdentity: {
        releaseId: ctx.releaseId ?? "",
        written: existsSync(buildIdentityPath),
        path: buildIdentityPath,
      },
      releaseSignResult,
      freshness,
      purgeResult,
      healthState,
      healthChecks,
      featureSmokeCheck,
      effectRecord: failedEffectRecord,
      bordbuchCommitted,
      systemStateUpdated,
      evidenceSynced,
      evidenceSyncError,
      failingPhase: failingPhase ?? "unknown",
      errorMessage,
    };
  }
}
