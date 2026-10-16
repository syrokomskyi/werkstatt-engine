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
  <item>RFC-1188: fo-review fix — outbound client resolved once per channel invocation and shared by health/freshness/feature-smoke instead of three independent resolutions</item>
  <item>RFC-1190: evidence.sync fail-closed when evidence/axiom + evidence-metadata.json exist (throws EVIDENCE_SYNC_FAILED, failingPhase "evidence-sync") and a clean no-op when absent — replaces the swallowed-error branch that reported deploy success while uploading nothing; axiomStatus/axiomExitCode + missionContext surfaced on DeployExecutionResult.</item>
  <item>RFC-1190: restore mission context + evidence archival in release-mode deploys

RFC-1190: precedence-ordered resolveMissionContext (--mission → release build-identity → currentMission), MISSION_CONTEXT_UNRESOLVED/MISMATCH blocking, fail-closed EVIDENCE_SYNC_FAILED with --skip-evidence-sync as sole escape hatch, journaled evidence-sync-* ship steps after each certify-*, evidence.sync --site/--system flag.

2026-10-04 handoff fixes: shared 25min mission.check timeout (inner 5min race + 300s orchestrator raced cold ~7-11min captures), sweep excludeOpIds so mission.close no longer self-abandons the live ship journal (broke --resume), name-keyed journal resume state so closed-mission plan shifts can't skip unexecuted steps, wrangler dev documented as the required --base-url preview server.</item>
  <item>RFC-1284: post-propagate access-pin reconcile — after a successful dev/alt
propagation, re-assert ACCESS_PIN from the freshly re-read system state when
protection is desired and no suspension marker is open. Non-fatal diagnostic on
accessReconcile; ACCESS-01 in sternsystem.validate is the hard backstop.</item>
  <item>RFC-1284: fix review REVIEW-CODE-2026-10-15-02: RFC-1284 — single-store marker, flag=false proceed, surfaced reconcile

F1: marker store unified on the git-tracked cache clone — access commands,
certify entry check, and deploy reconcile all use non-smart
readSystemState/writeSystemState (decisions Q-6); the mission-window
blindness and the DNA-106 false-resume are gone.
F2: --auto-manage-pin=false + suspension at entry skips entry-resume and
proceeds on the open channel (decisions Q-7) — RFC/AC-8 text amended.
F3: accessReconcile surfaced in data + summary of dev-deploy/propagate.
F4: CHANGE_SUMMARY items on all touched files.
F5: sternsystem.validate declares ACCESS-01/02 + system-state.yaml reads.
F6: isProtectedLiveTarget exported and covered (AC-12 probe repointed).
F7: fresh-read ordering proven — suspension opened mid-deploy suppresses
the re-assert.</item>
  <history>RFC-0866, RFC-0925, RFC-0931, RFC-0948, RFC-1092, RFC-1097, RFC-1138, RFC-1179, RFC-1188</history>
  <item>RFC-1297: buildAuthHeader re-exported from sternsystem/live-drift.ts (canonical home); gate selection uses gateForChannel.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import type { DeploymentAdapter, PropagateInput, HealthInput } from "./adapter.ts";
import { resolveOutboundAgentClient } from "./wba-signer.ts";
import type {
  DeploymentStaticConfig,
  DeploymentChannel,
  PurgeResult,
  HealthCheck,
  PropagationResult,
} from "@warpgogol/werkstatt-engine/schemas";
import type { Sha256Digest } from "@warpgogol/werkstatt-shared/fingerprint";
import type { AgentContractCheckResult } from "@warpgogol/werkstatt-shared/agent";
import {
  verifyFreshness,
  runMissionCheckWithResilience,
  type FreshnessResult,
  type MissionContext,
} from "./leitstand-commands.ts";
import type { AuthorizeOutcome } from "./deploy-helpers.ts";
import type { DeploymentEffectRecordV1 } from "../certification/deployment/authority.ts";
import {
  buildEffectRecord,
  writeDeploymentEffectRecord,
  gateForChannel,
} from "./deploy-helpers.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import {
  writeSystemStateSmart,
  readSystemStateSmart,
  readSystemState,
} from "../sternsystem/registry-io.ts";
import { collectPurgeUrls, purgeCacheByUrls, skippedPurgeResult } from "./cache-purge.ts";
import { readBehaviorSnapshot, sourceDotenv, filterEnv } from "./adapters/index.ts";
import { runWranglerSecretPut } from "./adapters/wrangler-secrets.ts";
import { fingerprintTree } from "@warpgogol/werkstatt-engine/fingerprint/semantic";
import { atomicWriteFile } from "../werkstatt/atomic.ts";
import {
  signBuildIdentity,
  writeReleasePublicKey,
  signLatestBuildArtifacts,
} from "../integrity/signing.ts";
import { loadPrivateKey } from "@warpgogol/werkstatt-engine/signing";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
// RFC-1297: canonical home moved to sternsystem/live-drift.ts so
// sternsystem.validate / ship preflight / rollback share the same PIN header;
// re-exported here so existing imports and test mocks keep working.
import { buildAuthHeader } from "../sternsystem/live-drift.ts";

export { buildAuthHeader };

const noopLogger = {
  info: (_m: string) => {},
  warn: (_m: string) => {},
  success: (_m: string) => {},
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  /** RFC-1190: full resolution record — how missionId/commitSha were obtained. */
  missionContext?: MissionContext;
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
  /** RFC-1116: external agent-surface contract check result — evidence, non-fatal. */
  agentContractCheck?: AgentContractCheckResult;
  effectRecord: DeploymentEffectRecordV1;
  bordbuchCommitted: boolean;
  systemStateUpdated: boolean;
  evidenceSynced: boolean;
  evidenceSyncError: string | null;
  /** RFC-1190: dev-channel post-deploy mission.check outcome (recorded, not just thrown). */
  axiomStatus: "pass" | "fail" | "not-run";
  axiomExitCode: number;
  /** RFC-1284: post-propagate ACCESS_PIN reconcile outcome — present only when the channel was eligible for reconciliation (dev/alt, pin declared, no suspension). */
  accessReconcile?: { ok: boolean; error?: string };
  /** RFC-1190: mission identity resolution record propagated to the deploy result. */
  missionContext?: MissionContext;
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
  fetchImpl: typeof fetch = fetch,
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
      const response = await fetchImpl(fetchUrl, {
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
  agentFetch?: typeof fetch,
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
        agentFetch,
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
  io: WorkspaceIO = createDefaultIO().io,
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
  let axiomStatus: "pass" | "fail" | "not-run" = "not-run";
  let axiomExitCode = 0;
  let bordbuchCommitted = false;
  let systemStateUpdated = false;
  let failingPhase: string | undefined;
  let releaseSignResult: DeployExecutionResult["releaseSignResult"];
  let featureSmokeCheck: FeatureSmokeCheckResult | undefined;
  let agentContractCheck: AgentContractCheckResult | undefined;
  let accessReconcile: DeployExecutionResult["accessReconcile"];

  const gate = gateForChannel(channel);

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
      if (!(await io.exists(distDir))) {
        try {
          const buildResult = await io.exec("sh", ["-c", "pnpm build"], {
            cwd: ctx.workspaceRoot,
            timeoutMs: 600000,
          });
          if (buildResult.exitCode !== 0) {
            throw new Error(
              `pnpm build exited ${buildResult.exitCode}: ${buildResult.stderr.slice(-400)}`,
            );
          }
        } catch (err) {
          failingPhase = "build";
          throw new Error(`Build failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        buildSkipped = true;
      }

      buildIdentityPath = path.join(distDir, "client", ".well-known", "build-identity.json");
      try {
        if (await io.exists(buildIdentityPath)) {
          const existing = JSON.parse(await io.readFile(buildIdentityPath));
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
    if (ctx.releaseId && buildIdentityPath && (await io.exists(buildIdentityPath))) {
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
              privateKeyPem = await io.readFile(privateKeyPath!);
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

    // --- RFC-1138: DNS upsert phase ---
    // Moved out of build.prepare — validate pipelines must not mutate external
    // state. DNS records are upserted here, in the deploy-bound path, before
    // the wrangler deploy so records exist when the site goes live.
    try {
      const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
      const dnsResult = (await executeKernelCommand({
        workspaceRoot: ctx.workspaceRoot,
        commandName: "dns.record.upsert",
        argv: [`--site=${ctx.systemId}`],
      })) as { exitCode?: number; summary?: string };
      if (dnsResult.exitCode !== 0) {
        failingPhase = "dns-upsert";
        throw new Error(`dns.record.upsert failed: ${dnsResult.summary ?? "unknown error"}`);
      }
    } catch (err) {
      if (failingPhase !== "dns-upsert") failingPhase = "dns-upsert";
      throw err;
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
    if (propagateResult.state !== "succeeded") {
      failingPhase = "wrangler-deploy";
      throw new Error(
        `Deploy failed: adapter '${ctx.adapter.name}' reported state=${propagateResult.state} (see adapter stderr above)`,
      );
    }
    const actualDeploymentUrl = propagateResult.deploymentUrl || deploymentUrl;

    // --- RFC-1284: access-pin reconcile ---
    // A crashed certify (or failed resume) can leave ACCESS_PIN deleted while
    // accessPin still declares protection. Re-assert the secret on dev/alt
    // immediately after a successful propagation — before purge/health/smoke
    // phases that can throw — so every deploy converges the projection to the
    // desired state. Fresh state re-read: a concurrent certify may have opened
    // a suspension during the build/deploy window. The cache clone owns the
    // marker — non-smart read, same store as the access commands (Q-6).
    // Reconcile failure is a non-fatal diagnostic — ACCESS-01 in
    // sternsystem.validate is the backstop.
    if (channel !== "main") {
      try {
        const freshState = await readSystemState(ctx.workspaceRoot, ctx.systemId);
        const desiredPin = freshState?.accessPin ?? null;
        const suspended = (freshState?.accessPinSuspended ?? null) !== null;
        if (desiredPin !== null && !suspended) {
          const secretsEnv = ctx.secretsFilePath ? await sourceDotenv(ctx.secretsFilePath) : {};
          const pinEnv = {
            ...filterEnv(process.env as Record<string, string | undefined>),
            ...secretsEnv,
          };
          const putResult = await runWranglerSecretPut(
            channelConfig.workerName,
            "ACCESS_PIN",
            desiredPin,
            pinEnv,
            ctx.workspaceRoot,
          );
          accessReconcile =
            putResult.exitCode === 0
              ? { ok: true }
              : {
                  ok: false,
                  error:
                    putResult.stderr.trim() ||
                    putResult.stdout.trim() ||
                    `exit code ${putResult.exitCode}`,
                };
        }
      } catch (err) {
        accessReconcile = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    if (channel !== "dev" || !isDevWorkersUrl(actualDeploymentUrl)) {
      if (ctx.adapter.purgeCapable()) {
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
    }

    // RFC-1188: all agent-directed probes of this channel go through one
    // outbound resolution — health, freshness, and feature-smoke share it.
    const outbound = await resolveOutboundAgentClient(ctx.workspaceRoot, ctx.systemId);

    if (channel !== "dev" || !isDevWorkersUrl(actualDeploymentUrl)) {
      if (localDistTreeHash) {
        freshness = await verifyFreshness(
          actualDeploymentUrl,
          localDistTreeHash,
          noopLogger,
          authHeaders,
          outbound.client.fetch,
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
      outbound.client.fetch,
    );
    healthState = healthResult.state;
    healthChecks = healthResult.checks;
    if (healthState === "unhealthy") {
      failingPhase = "health-check";
      throw new Error("Health check failed — deployment is unhealthy");
    }

    // RFC-1179: blocking smoke gates on every channel — fetch-level status/body
    // checks (site.smoke.run) then the Playwright runtime gate
    // (deploy.smoke.run: console errors, pageerror, requestfailed, 4xx/5xx).
    // Both run unconditionally — dev workers.dev URLs included — so a broken
    // release never propagates to the next channel.
    {
      const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
      const smokeArgv = [
        `--site=${ctx.systemId}`,
        `--url=${actualDeploymentUrl}`,
        "--json",
        ...(ctx.releaseId ? [`--release-id=${ctx.releaseId}`] : []),
        ...(ctx.commitSha ? [`--commit-sha=${ctx.commitSha}`] : []),
      ];
      const siteSmokeResult = (await executeKernelCommand({
        workspaceRoot: ctx.workspaceRoot,
        commandName: "site.smoke.run",
        argv: smokeArgv,
      })) as { exitCode?: number; summary?: string };
      if ((siteSmokeResult.exitCode ?? 1) !== 0) {
        failingPhase = "site-smoke";
        throw new Error(`site.smoke.run failed: ${siteSmokeResult.summary ?? "unknown error"}`);
      }
      const deploySmokeResult = (await executeKernelCommand({
        workspaceRoot: ctx.workspaceRoot,
        commandName: "deploy.smoke.run",
        argv: smokeArgv,
      })) as { exitCode?: number; summary?: string };
      if ((deploySmokeResult.exitCode ?? 1) !== 0) {
        failingPhase = "deploy-smoke";
        throw new Error(`deploy.smoke.run failed: ${deploySmokeResult.summary ?? "unknown error"}`);
      }
    }

    // RFC-0948: Post-deploy feature smoke check — non-fatal warning
    if (channel !== "dev" || !isDevWorkersUrl(actualDeploymentUrl)) {
      featureSmokeCheck = await runFeatureSmokeCheck(
        actualDeploymentUrl,
        authHeaders,
        ctx.workspaceRoot,
        ctx.releaseId,
        outbound.client.fetch,
      );
    }

    // RFC-0954: Warm the search index — non-fatal on failure
    try {
      const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
      await executeKernelCommand({
        workspaceRoot: ctx.workspaceRoot,
        commandName: "agent.search.warm",
        argv: [`--site=${ctx.systemId}`],
      });
    } catch {
      // Non-fatal — search index warm-up is best-effort
    }

    // RFC-1116: External agent-surface contract check — non-fatal, recorded as
    // deploy evidence; certification consumes the result like other smoke data.
    try {
      const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
      const contractResult = (await executeKernelCommand({
        workspaceRoot: ctx.workspaceRoot,
        commandName: "agent.surface.contract.check",
        argv: [`--url=${actualDeploymentUrl}`],
      })) as { data?: AgentContractCheckResult };
      agentContractCheck = contractResult.data;
    } catch {
      // Non-fatal — contract check is best-effort evidence
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
        axiomExitCode = missionResult.exitCode;
        axiomStatus = missionResult.exitCode === 0 ? "pass" : "fail";
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
        if ((await io.exists(metadataPath)) && (await io.exists(studyRunPath))) {
          const metadata = JSON.parse(await io.readFile(metadataPath));
          const studyRun = JSON.parse(await io.readFile(studyRunPath));
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
          outbound.client.fetch,
        );
        if (altHealth.state !== "healthy") {
          failingPhase = "alt-health-check";
          throw new Error(
            `Alt channel is not healthy (state=${altHealth.state}) — cannot promote to main`,
          );
        }
      }
    }

    // RFC-1190: evidence archival is fail-closed once axiom evidence exists —
    // previously failures were swallowed into a field nothing surfaced while
    // deployState reported "succeeded" (DNA-106). Absent evidence dir or
    // missing evidence-metadata.json is a clean no-op, not a failure.
    if (!ctx.skipEvidenceSync && ctx.missionId) {
      const { resolveMissionDir } = await import("../kernel/mission-resolver.ts");
      const missionDir = await resolveMissionDir(ctx.workspaceRoot, ctx.missionId, io);
      const axiomEvidenceDir = path.join(missionDir, "evidence", "axiom");
      const hasAxiomEvidence =
        (await io.exists(axiomEvidenceDir)) &&
        (await io.exists(path.join(axiomEvidenceDir, "evidence-metadata.json")));
      if (hasAxiomEvidence) {
        try {
          const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
          const syncResult = (await executeKernelCommand({
            workspaceRoot: ctx.workspaceRoot,
            commandName: "evidence.sync",
            argv: [`--site=${ctx.systemId}`, `--mission=${ctx.missionId}`],
          })) as
            | { exitCode?: number; summary?: string }
            | Array<{ exitCode?: number; summary?: string }>;
          const reports = Array.isArray(syncResult) ? syncResult : [syncResult];
          const failed = reports.find((r) => (r?.exitCode ?? 0) !== 0);
          if (failed) throw new Error(failed?.summary ?? "evidence.sync exited non-zero");
          evidenceSynced = true;
        } catch (err) {
          evidenceSyncError = err instanceof Error ? err.message : String(err);
          failingPhase = "evidence-sync";
          throw new Error(`EVIDENCE_SYNC_FAILED: ${evidenceSyncError}`);
        }
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
        written: await io.exists(buildIdentityPath),
        path: buildIdentityPath,
      },
      releaseSignResult,
      freshness,
      purgeResult,
      healthState,
      healthChecks,
      featureSmokeCheck,
      agentContractCheck,
      effectRecord: finalEffectRecord,
      bordbuchCommitted,
      systemStateUpdated,
      evidenceSynced,
      evidenceSyncError,
      axiomStatus,
      axiomExitCode,
      accessReconcile,
      missionContext: ctx.missionContext,
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
        written: await io.exists(buildIdentityPath),
        path: buildIdentityPath,
      },
      releaseSignResult,
      freshness,
      purgeResult,
      healthState,
      healthChecks,
      featureSmokeCheck,
      agentContractCheck,
      effectRecord: failedEffectRecord,
      bordbuchCommitted,
      systemStateUpdated,
      evidenceSynced,
      evidenceSyncError,
      axiomStatus,
      axiomExitCode,
      accessReconcile,
      missionContext: ctx.missionContext,
      failingPhase: failingPhase ?? "unknown",
      errorMessage,
    };
  }
}
