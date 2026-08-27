/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/leitstand/leitstand-commands.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0358: initial leitstand command handlers.</item>
  <item>RFC-0379: channel model — alt/main channels, preflight, resolveAdapter throws for unimplemented, per-channel lastPropagated with operational state, --channel flag on all commands.</item>
  <item>RFC-0379 post-review: complete preflight (artifact hash, wrangler availability, dist size limit); add artifact-store rehydration for propagate and rollback.</item>
  <item>RFC-0587: adapter-declared size limits via getLimits() passed through runPreflight to checkDistSize; remove hardcoded limit constants.</item>
  <item>RFC-0608: leitstand.propagate always deploys to alt (removes --channel); adds leitstand.promote for alt→main with build-identity verification; rollback transitions release state.</item>
  <item>RFC-0624: add post-deploy CDN cache purge step to propagate, promote, and rollback; record purgeResult in lastPropagated; display in status.</item>
  <item>RFC-0627: add dev channel, leitstand.deploy command, Axiom evidence gate in propagate, auto-step rollback.</item>
  <item>RFC-0628: replace leitstand.deploy with workpiece-based leitstand.dev-deploy; remove dev-deployed state; propagate gate checks published + commitSha + missionId + errors===0; rollback auto-step removes dev-deployed.</item>
  <item>RFC-0629: propagate gate reads evidence-metadata.json + study-run.json (native Axiom format); dev-deploy passes --commit-sha to mission.check (no evidence post-processing); JSON.parse wrapped with error handling.</item>
  <item>RFC-0634: dev-deploy writes preliminary + final build-identity.json (preliminary in public/.well-known/ before build, final in dist/client/.well-known/ after hash computation with dist cleanup); propagate verifies dev build-identity before deploying to alt; release.prepare uses workpiece HEAD for commitSha.</item>
  <item>RFC-0649: dev-deploy treats CDN purge as fatal for cloudflare-workers adapter (checks purgeResult.success); adds verifyFreshness function that fetches build-identity.json from CDN URL and compares distTreeHash; skips purge + freshness check for null adapter; freshness mismatch stops pipeline before Axiom gate.</item>
  <item>RFC-0653: dev-deploy implements build-skip cache — skips pnpm build when commitSha + platformVersion + platformSemanticHash match .dev-deploy-build-cache.json and dist/ exists. --force-build bypasses the cache. buildSkipped field added to DevDeployResult.</item>
  <item>RFC-0652: best-effort evidence.sync after axiom.report; --skip-evidence-sync flag; evidenceSynced/evidenceSyncError in output.</item>
  <item>RFC-0656: switch distTreeHash from mode: "byte" to mode: "stable" for deterministic hashing of non-deterministic build artifacts.</item>
  <item>RFC-0657: replace single-fetch verifyFreshness with retry loop (5 attempts, exponential backoff 3s/6s/12s/24s); remove fixed 6s sleep after purge; add attempts field to FreshnessResult.</item>
  <item>RFC-0665: add methodologies.validate pre-flight to dev-deploy; fail fast on invalid methodologies config before build+deploy cycle.</item>
  <item>RFC-0668: wrap mission.check call with 15-min per-attempt timeout (MISSION_CHECK_TIMEOUT_MS) and one-time retry on infrastructure errors (exit 2 or any non-0/non-1); pass --max-duration to mission.check; worst-case total 30 min with retry.</item>
  <item>Add --no-report flag (default true) to runMissionCheckWithResilience to suppress report.html generation in mission.check; axiom.report is auto-invoked separately in leitstand.dev-deploy, preventing double-write.</item>
  <item>RFC-0689: clear Axiom browser evidence cache before mission.check; auto-regenerate behavior snapshot on SNAP-01 when pnpm build fails; check stale snapshot when build is skipped (RFC-0653).</item>
  <item>RFC-0697: log cache dir file count and total size before clearing; extract shared orchestrateSnap01Recovery helper for SNAP-01 detect → regenerate → (optional) rebuild orchestration.</item>
  <item>RFC-0698: auto-commit workpiece via mission.git.commit after pnpm build completes and before distTreeHash computation; re-read commitSha from workpiece HEAD after auto-commit; fatal abort on commit failure; move build-skip cache write to after auto-commit with post-commit commitSha.</item>
  <item>RFC-0700: add --release flag to leitstand.dev-deploy for deploying existing releases to dev without open mission; skips build, axiom checks, and auto-commit; resolves secrets from releases/&lt;id&gt;/.env; resolves wrangler from workspace root node_modules/.bin; adds releaseDeployed field to DevDeployResult.</item>
  <item>RFC-0747: add retry loop (3 attempts, 3s/6s backoff) to alt health check in leitstand.promote to handle CDN propagation delays.</item>
  <item>RFC-0829: add test evidence gates (L4+L5) to propagate and promote via shared runTestEvidenceGate helper.</item>
  <item>RFC-0842: add target channel + URL logging to dev-deploy, propagate, and promote before lock acquisition.</item>
  <item>RFC-0866: wire executeDeployPhases into dev-deploy, propagate, promote; add failingPhase to result types.</item>
  <item>RFC-0866 audit: resolve missionId + commitSha from system-state + workpiece git HEAD; pass to executeDeployPhases so mission.check and Axiom evidence gate actually run.</item>
  <item>RFC-0866 audit: add alt health check before main deploy in executeDeployPhases for channel=main.</item>
  <item>RFC-0927: add runLeitstandHotfixDevDeploy composite command handler chaining 7 phases via executeKernelCommand.</item>
  <item>RFC-0930: add runLeitstandVerify command handler — fetches build-identity.json from live CDN URLs for all configured channels, compares distTreeHash cross-channel, optionally compares against local system-state.yaml records.</item>
  <item>RFC-0948: add channel drift warning to runLeitstandDevDeploy — compares dev releaseId against alt/main lastPropagated and emits non-fatal warning when they differ.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import path, { join } from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import type {
  PropagationResult,
  HealthCheck,
  DeploymentStaticConfig,
  DeploymentChannel,
  LastPropagatedChannel,
  PurgeResult,
} from "@warpgogol/werkstatt-engine/schemas";
import { generateOperationId } from "../werkstatt/index.ts";
import {
  readSystemConfigSmart,
  readSystemStateSmart,
  resolveCacheClonePath,
} from "../sternsystem/registry-io.ts";
import type {
  DeploymentAdapter,
  DeploymentLimits,
  PropagateInput,
  RollbackInput,
  RollbackResult,
  HealthInput,
} from "./adapter.ts";
import {
  createCloudflareWorkersAdapter,
  readBehaviorSnapshot,
  sourceDotenv,
  filterEnv,
} from "./adapters/index.ts";
import {
  collectPurgeUrls,
  purgeCacheByUrls,
  skippedPurgeResult,
  verifyCloudflareToken,
  BUILD_IDENTITY_PATH,
} from "./cache-purge.ts";
import { artifactStorePreflight } from "../artifact-store/index.ts";
import { verifyBuildIdentitySignature } from "../integrity/signing.ts";
import { execSync } from "node:child_process";
import { executeKernelCommand, KERNEL_UNIVERSAL_FLAGS } from "@warpgogol/werkstatt-engine/kernel";
import { getOrBuildWorkspaceRegistry } from "../kernel/runtime/registry-cache.ts";
import type { SmokeRunResult } from "@warpgogol/werkstatt-engine/testing/smoke";
import type { SiteE2eRunResult } from "@warpgogol/werkstatt-engine/testing/e2e";
import {
  authorizeAndDeploy,
  verifyDurableSync,
  authorizeMainPromotion,
  buildEffectRecord,
  writeDeploymentEffectRecord,
  makeR2ConfigFromEnv,
  resolveArtifactHash,
  resolveGateDecisionPath,
  flagSite,
} from "./deploy-helpers.ts";
import { buildAuthHeader } from "./deploy-execution.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";

function _logCacheDirSize(cacheDir: string, logger: { info: (msg: string) => void }): void {
  try {
    const entries = readdirSync(cacheDir, { withFileTypes: true });
    let totalSize = 0;
    let fileCount = 0;
    for (const entry of entries) {
      if (entry.isFile()) {
        fileCount++;
        totalSize += statSync(join(cacheDir, entry.name)).size;
      }
    }
    logger.info(
      `[leitstand.dev-deploy] Axiom cache: ${fileCount} file(s), ${(totalSize / 1024 / 1024).toFixed(1)} MiB — clearing…`,
    );
  } catch {
    // Non-fatal — log nothing if we can't read the directory
  }
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

type Channel = "dev" | "alt" | "main";

function parseChannel(value: string | undefined, defaultValue: Channel): Channel {
  if (value === "dev" || value === "alt" || value === "main") return value;
  return defaultValue;
}

// Null adapter for test fixtures and adapter: "null" registry entries
const nullAdapter: DeploymentAdapter = {
  name: "null",
  async propagate(input: PropagateInput): Promise<PropagationResult> {
    const now = new Date().toISOString();
    return {
      systemId: input.systemId,
      releaseId: input.releaseId,
      state: "succeeded",
      deploymentUrl: input.url,
      startedAt: now,
      completedAt: now,
      healthChecks: [],
    };
  },
  async rollback(input: RollbackInput): Promise<RollbackResult> {
    const now = new Date().toISOString();
    return {
      systemId: input.systemId,
      channel: input.channel,
      state: "succeeded",
      workerName: input.workerName,
      startedAt: now,
      completedAt: now,
      stdout: "",
      stderr: "",
    };
  },
  async health(_input: HealthInput) {
    return { state: "unknown" as const, checks: [] };
  },
  getLimits() {
    return { maxTotalSize: Infinity, maxFileSize: Infinity };
  },
};

function resolveAdapter(name: string | undefined): DeploymentAdapter {
  if (!name || name === "null") return nullAdapter;
  if (name === "cloudflare-workers") return createCloudflareWorkersAdapter();
  throw new Error(`[leitstand] adapter-not-implemented: '${name}' has no concrete implementation`);
}

function _getChannelConfig(dep: DeploymentStaticConfig, channel: Channel): DeploymentChannel {
  const channelConfig =
    channel === "dev" ? dep.channels.dev : channel === "alt" ? dep.channels.alt : dep.channels.main;
  if (!channelConfig) {
    throw new Error(`[leitstand] channel '${channel}' is not defined for system`);
  }
  return channelConfig;
}

function resolveConventionSecretsPath(basePath: string): string | undefined {
  const filePath = path.join(basePath, ".env");
  return existsSync(filePath) ? filePath : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// RFC-0668: Timeout and retry resilience for mission.check in leitstand.dev-deploy.
const MISSION_CHECK_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes, per-attempt
const MISSION_CHECK_MAX_RETRIES = 1;

class MissionCheckTimeoutError extends Error {
  constructor(ms: number) {
    super(`mission.check timed out after ${ms}ms`);
    this.name = "MissionCheckTimeoutError";
  }
}

async function withMissionCheckTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new MissionCheckTimeoutError(ms)), ms),
    ),
  ]);
}

// RFC-0668: Wrap mission.check with per-attempt timeout and one-time retry on
// infrastructure errors (exit code 2 or any non-0/non-1). Content violations
// (exit 1) are not retried — they indicate real site issues.
export async function runMissionCheckWithResilience(
  workspaceRoot: string,
  missionId: string,
  channelUrl: string,
  commitSha: string,
  logger: { info: (m: string) => void; warn: (m: string) => void },
  noReport = true,
): Promise<{ exitCode: number; data?: Record<string, unknown> }> {
  const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");

  for (let attempt = 0; attempt <= MISSION_CHECK_MAX_RETRIES; attempt++) {
    try {
      const result = (await withMissionCheckTimeout(
        executeKernelCommand({
          workspaceRoot,
          commandName: "mission.check",
          argv: [
            `--mission=${missionId}`,
            "--external-preview",
            `--base-url=${channelUrl}`,
            `--commit-sha=${commitSha}`,
            `--max-duration=${MISSION_CHECK_TIMEOUT_MS}`,
            "--channel=dev",
            ...(noReport ? ["--no-report"] : []),
          ],
        }),
        MISSION_CHECK_TIMEOUT_MS,
      )) as { exitCode?: number; data?: Record<string, unknown> };

      const exitCode = result.exitCode ?? 0;

      // Exit 0 = pass, exit 1 = content violations — return to caller, no retry
      if (exitCode === 0 || exitCode === 1) {
        return { exitCode, data: result.data };
      }

      // Exit 2 = infrastructure error, 3+ = unexpected, 137 = signal kill — retry once
      if (attempt < MISSION_CHECK_MAX_RETRIES) {
        logger.info(
          `[leitstand.dev-deploy] mission.check infrastructure error (exit ${exitCode}, attempt ${attempt + 1}/${MISSION_CHECK_MAX_RETRIES + 1}), retrying...`,
        );
        continue;
      }

      // Retry exhausted
      return { exitCode, data: result.data };
    } catch (err) {
      if (err instanceof MissionCheckTimeoutError) {
        // Timeout is not retryable — a hung process indicates a deeper issue
        throw err;
      }
      // Unexpected throw from executeKernelCommand — treat as infrastructure error, retry once
      if (attempt < MISSION_CHECK_MAX_RETRIES) {
        logger.info(
          `[leitstand.dev-deploy] mission.check threw (attempt ${attempt + 1}/${MISSION_CHECK_MAX_RETRIES + 1}), retrying...`,
        );
        continue;
      }
      throw err;
    }
  }

  throw new Error("mission.check failed after retry");
}

// RFC-0649 / RFC-0657: Result of CDN freshness verification.
export interface FreshnessResult {
  verified: boolean;
  cdnDistTreeHash: string | null;
  localDistTreeHash: string;
  attempts: number;
  error?: string;
}

// RFC-0657: Retry constants for verifyFreshness (hardcoded — no caller customization needed).
const FRESHNESS_MAX_ATTEMPTS = 5;
const FRESHNESS_BACKOFF_DELAYS_MS = [3_000, 6_000, 12_000, 24_000];

// Shared health check retry constants (RFC-0747, RFC-0846).
// Used by leitstand.dev-deploy (dev health) and leitstand.promote (alt health).
const _HEALTH_CHECK_MAX_ATTEMPTS = 3;
const _HEALTH_CHECK_BACKOFF_DELAYS_MS = [3_000, 6_000];

// RFC-0649 / RFC-0657: Verify CDN freshness by fetching build-identity.json from the CDN URL
// and comparing distTreeHash against the local build-identity. Retries up to 5 times with
// exponential backoff (3s, 6s, 12s, 24s). First attempt is immediate; subsequent attempts
// are separated by the backoff delays.
export async function verifyFreshness(
  deploymentUrl: string,
  localDistTreeHash: string,
  logger: { info: (m: string) => void },
  authHeaders: Record<string, string> = {},
): Promise<FreshnessResult> {
  const base = deploymentUrl.replace(/\/$/, "");
  const url = `${base}${BUILD_IDENTITY_PATH}`;
  let lastCdnDistTreeHash: string | null = null;
  let lastError = "";

  for (let attempt = 1; attempt <= FRESHNESS_MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      const delayMs = FRESHNESS_BACKOFF_DELAYS_MS[attempt - 2];
      logger.info(
        `[leitstand.dev-deploy] freshness retry ${attempt}/${FRESHNESS_MAX_ATTEMPTS} after ${delayMs / 1000}s...`,
      );
      await sleep(delayMs);
    }

    try {
      const response = await fetch(url, { headers: authHeaders });
      if (!response.ok) {
        lastCdnDistTreeHash = null;
        lastError = `CDN freshness fetch returned HTTP ${response.status} for ${url}`;
        continue;
      }
      const cdnBuildIdentity = (await response.json()) as { distTreeHash?: string };
      const cdnDistTreeHash = cdnBuildIdentity.distTreeHash ?? null;
      lastCdnDistTreeHash = cdnDistTreeHash;
      if (cdnDistTreeHash !== localDistTreeHash) {
        lastError = `CDN serving stale content: distTreeHash mismatch (cdn: ${cdnDistTreeHash}, local: ${localDistTreeHash})`;
        continue;
      }
      return {
        verified: true,
        cdnDistTreeHash,
        localDistTreeHash,
        attempts: attempt,
      };
    } catch (err) {
      lastCdnDistTreeHash = null;
      lastError = `CDN freshness fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return {
    verified: false,
    cdnDistTreeHash: lastCdnDistTreeHash,
    localDistTreeHash,
    attempts: FRESHNESS_MAX_ATTEMPTS,
    error: lastError,
  };
}

// RFC-0624: Post-deploy CDN cache purge step. Non-blocking on failure.
async function _runPurgeStep(
  workspaceRoot: string,
  releaseId: string,
  deploymentUrl: string,
  secretsFilePath: string | undefined,
  logger: { info: (m: string) => void; success: (m: string) => void; warn: (m: string) => void },
): Promise<PurgeResult> {
  const secretsEnv = secretsFilePath ? await sourceDotenv(secretsFilePath) : {};
  const env = { ...filterEnv(process.env), ...secretsEnv };

  const zoneId = env["CLOUDFLARE_ZONE_ID"];
  const apiToken = env["CLOUDFLARE_API_TOKEN"];

  if (!zoneId) {
    logger.warn("[leitstand] CLOUDFLARE_ZONE_ID not set — skipping CDN cache purge");
    return skippedPurgeResult("CLOUDFLARE_ZONE_ID not set");
  }
  if (!apiToken) {
    logger.warn("[leitstand] CLOUDFLARE_API_TOKEN not set — skipping CDN cache purge");
    return skippedPurgeResult("CLOUDFLARE_API_TOKEN not set");
  }

  const snapshot = await readBehaviorSnapshot(workspaceRoot, releaseId);
  const routes = snapshot?.routes ?? [];
  const urls = collectPurgeUrls(deploymentUrl, routes);

  logger.info(`[leitstand] Purging CDN cache for ${urls.length} URLs...`);

  const result = await purgeCacheByUrls(zoneId, apiToken, urls);
  if (result.success) {
    logger.success(`[leitstand] CDN cache purged (${result.purgedUrls} URLs)`);
  } else {
    logger.warn(`[leitstand] CDN cache purge failed: ${result.error}`);
  }
  return result;
}

async function _earlyCloudflareTokenCheck(
  secretsFilePath: string | undefined,
  logger: { info: (m: string) => void; warn: (m: string) => void },
): Promise<void> {
  const secretsEnv = secretsFilePath ? await sourceDotenv(secretsFilePath) : {};
  const env = { ...filterEnv(process.env), ...secretsEnv };
  const zoneId = env["CLOUDFLARE_ZONE_ID"];
  const apiToken = env["CLOUDFLARE_API_TOKEN"];
  if (!zoneId || !apiToken) {
    logger.warn(
      `[leitstand] ${!zoneId ? "CLOUDFLARE_ZONE_ID" : "CLOUDFLARE_API_TOKEN"} not set — CDN cache purge will be skipped and health checks may report unhealthy due to stale cache`,
    );
    return;
  }
  const tokenCheck = await verifyCloudflareToken(zoneId, apiToken);
  if (!tokenCheck.valid) {
    logger.warn(
      `[leitstand] Cloudflare API token invalid: ${tokenCheck.error}. CDN cache purge will fail. Health checks will report unhealthy due to stale cache. Update CLOUDFLARE_API_TOKEN in .env before deploying.`,
    );
  } else {
    logger.info("[leitstand] Cloudflare API token verified");
  }
}

interface PreflightCheck {
  name: string;
  passed: boolean;
  detail: string;
}

async function _runPreflight(
  workspaceRoot: string,
  releaseId: string,
  dep: DeploymentStaticConfig,
  channel: Channel,
  channelConfig: DeploymentChannel,
  adapter: DeploymentAdapter,
  missionId?: string,
  basePath?: string,
): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];

  // 1. Release state is ready (already verified by caller, but record it)
  const manifestPath = path.join(workspaceRoot, "releases", releaseId, "release.yaml");
  checks.push({
    name: "release-ready",
    passed: existsSync(manifestPath),
    detail: existsSync(manifestPath) ? "Release manifest found" : "Release manifest missing",
  });

  // 2. Channel exists in deployment.channels
  checks.push({
    name: "channel-present",
    passed: !!channelConfig,
    detail: channelConfig ? `Channel '${channel}' configured` : `Channel '${channel}' not defined`,
  });

  // 3. Convention env file existence (RFC-0761: single .env file)
  const envPath = basePath ? path.join(basePath, ".env") : "";
  checks.push({
    name: "convention-env-exists",
    passed: true, // info-level — always passed
    detail:
      basePath && existsSync(envPath)
        ? `.env found at ${envPath}`
        : `.env not found — using process.env fallback`,
  });

  // 4. Dist directory exists and artifact hash verifies
  const distPath = path.join(workspaceRoot, "releases", releaseId, "dist");
  const artifactResult = await artifactStorePreflight(workspaceRoot, releaseId, distPath);
  checks.push({
    name: "artifact-hash",
    passed: artifactResult.manifestFound && (artifactResult.hashVerified || !existsSync(distPath)),
    detail: !artifactResult.manifestFound
      ? "Artifact manifest not found in store"
      : !existsSync(distPath)
        ? "Dist missing locally (will rehydrate from store)"
        : artifactResult.hashVerified
          ? "Dist tree hash matches artifact manifest"
          : "Dist tree hash mismatch — will rehydrate from store",
  });

  // 5. Wrangler binary resolves
  let wranglerBinPath: string | undefined;
  if (missionId) {
    const workpieceBin = path.join(
      workspaceRoot,
      "missions",
      missionId,
      "workpiece",
      "node_modules",
      ".bin",
    );
    if (existsSync(workpieceBin)) {
      wranglerBinPath = workpieceBin;
    }
  }
  const wranglerCheck = await checkWranglerAvailable(workspaceRoot, wranglerBinPath);
  checks.push({
    name: "wrangler-available",
    passed: wranglerCheck.available,
    detail: wranglerCheck.detail,
  });

  // 6. Dist size within adapter-declared limits
  if (existsSync(distPath)) {
    const sizeCheck = await checkDistSize(distPath, adapter.getLimits());
    checks.push({
      name: "dist-size-limit",
      passed: sizeCheck.withinLimit,
      detail: sizeCheck.detail,
    });
  }

  // 7. Cloudflare API token valid (pre-flight check to avoid stale CDN after deploy)
  const secretsFilePath = basePath ? resolveConventionSecretsPath(basePath) : undefined;
  const secretsEnv = secretsFilePath ? await sourceDotenv(secretsFilePath) : {};
  const env = { ...filterEnv(process.env), ...secretsEnv };
  const zoneId = env["CLOUDFLARE_ZONE_ID"];
  const apiToken = env["CLOUDFLARE_API_TOKEN"];
  if (!zoneId || !apiToken) {
    checks.push({
      name: "cloudflare-token",
      passed: true, // info-level — deploy can proceed without purge
      detail: !zoneId
        ? "CLOUDFLARE_ZONE_ID not set — CDN purge will be skipped"
        : "CLOUDFLARE_API_TOKEN not set — CDN purge will be skipped",
    });
  } else {
    const tokenCheck = await verifyCloudflareToken(zoneId, apiToken);
    checks.push({
      name: "cloudflare-token",
      passed: tokenCheck.valid,
      detail: tokenCheck.valid
        ? "Cloudflare API token valid"
        : `Cloudflare API token invalid: ${tokenCheck.error}`,
    });
  }

  return checks;
}

async function checkWranglerAvailable(
  workspaceRoot: string,
  nodeModulesBinPath?: string,
): Promise<{ available: boolean; detail: string }> {
  try {
    const { execFile } = await import("node:child_process");
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (nodeModulesBinPath) {
      env.PATH = `${nodeModulesBinPath}:${process.env.PATH ?? ""}`;
    }
    const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>(
      (resolve) => {
        execFile(
          "npx",
          ["--yes", "wrangler", "--version"],
          { cwd: workspaceRoot, env },
          (err, stdout, stderr) => {
            resolve({
              exitCode: err ? 1 : 0,
              stdout: stdout ?? "",
              stderr: stderr ?? "",
            });
          },
        );
      },
    );
    if (result.exitCode === 0) {
      return { available: true, detail: `wrangler resolved: ${result.stdout.trim()}` };
    }
    return {
      available: false,
      detail: `wrangler --version exited non-zero: ${result.stderr.trim().slice(0, 100)}`,
    };
  } catch {
    return { available: false, detail: "wrangler binary not found" };
  }
}

async function checkDistSize(
  distPath: string,
  limits: DeploymentLimits,
): Promise<{ withinLimit: boolean; detail: string }> {
  let totalSize = 0;
  let largestFile = 0;
  let largestFilePath = "";
  const { collectFiles } = await import("@warpgogol/werkstatt-shared/share/fs");
  for (const file of await collectFiles(distPath)) {
    const stat = await fs.stat(file);
    totalSize += stat.size;
    if (stat.size > largestFile) {
      largestFile = stat.size;
      largestFilePath = file;
    }
  }
  const sizeWithinLimit = totalSize <= limits.maxTotalSize;
  const perFileWithinLimit = largestFile <= limits.maxFileSize;
  const withinLimit = sizeWithinLimit && perFileWithinLimit;
  const totalLimitMiB = limits.maxTotalSize / 1024 / 1024;
  const fileLimitMiB = limits.maxFileSize / 1024 / 1024;
  return {
    withinLimit,
    detail: withinLimit
      ? `Dist size ${(totalSize / 1024 / 1024).toFixed(2)} MiB within ${totalLimitMiB.toFixed(0)} MiB total limit`
      : !sizeWithinLimit
        ? `Dist size ${(totalSize / 1024 / 1024).toFixed(2)} MiB exceeds ${totalLimitMiB.toFixed(0)} MiB total limit`
        : `Largest file ${largestFilePath} (${(largestFile / 1024 / 1024).toFixed(2)} MiB) exceeds ${fileLimitMiB.toFixed(0)} MiB per-file limit`,
  };
}

function _buildLastPropagatedEntry(
  releaseId: string,
  state: LastPropagatedChannel["state"],
  healthy: boolean,
  operationId: string,
  purgeResult?: PurgeResult,
): LastPropagatedChannel {
  return {
    releaseId,
    at: new Date().toISOString(),
    healthy,
    state,
    operationId,
    leaseExpiresAt: null,
    purgeResult,
  };
}

// §5.0: leitstand.dev-deploy (RFC-0628: workpiece-based dev deploy with Axiom verification gate)

interface PreparedDeployContext {
  adapter: DeploymentAdapter;
  systemConfig: DeploymentStaticConfig;
  secretsFilePath: string | undefined;
}

async function prepareDeployContext(
  workspaceRoot: string,
  systemId: string,
  commandName: string,
): Promise<PreparedDeployContext> {
  const systemConfig = await readSystemConfigSmart(workspaceRoot, systemId);
  if (!systemConfig.deployment) {
    throw new Error(
      `[${commandName}] system '${systemId}' has no deployment config in system-config.yaml`,
    );
  }
  const adapter = resolveAdapter(systemConfig.deployment.adapter);
  return {
    adapter,
    systemConfig: systemConfig.deployment,
    secretsFilePath: undefined,
  };
}

function resolveSecretsFilePath(
  workspaceRoot: string,
  channelConfig: DeploymentChannel | undefined,
): string | undefined {
  return channelConfig?.secretsFile
    ? path.join(workspaceRoot, channelConfig.secretsFile)
    : undefined;
}

async function resolveMissionContext(
  workspaceRoot: string,
  systemId: string,
): Promise<{ missionId: string; commitSha: string }> {
  try {
    const state = await readSystemStateSmart(workspaceRoot, systemId);
    const missionId = state.currentMission ?? "";
    if (!missionId) return { missionId: "", commitSha: "" };
    const workpieceDir = path.join(workspaceRoot, "missions", missionId, "workpiece");
    if (!existsSync(workpieceDir)) return { missionId, commitSha: "" };
    let commitSha = "";
    try {
      commitSha = execSync("git rev-parse HEAD", {
        cwd: workpieceDir,
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();
    } catch {
      // workpiece may not be a git repo
    }
    return { missionId, commitSha };
  } catch {
    return { missionId: "", commitSha: "" };
  }
}

export interface DevDeployResult {
  command: "leitstand.dev-deploy";
  systemId: string;
  missionId: string;
  commitSha: string;
  buildState: "succeeded" | "failed";
  buildSkipped: boolean;
  deployState: "succeeded" | "failed" | "failed-stale" | "in-progress";
  deploymentUrl: string;
  buildIdentity: {
    releaseId: string;
    written: boolean;
    path: string;
  };
  axiom: {
    status: "pass" | "fail" | "not-run";
    errors: number;
    warnings: number;
    exitCode: number;
    freshness: FreshnessResult;
  };
  smokeResult?: SmokeRunResult;
  e2eResult?: SiteE2eRunResult;
  evidenceSynced: boolean;
  evidenceSyncError: string | null;
  releaseDeployed?: string;
  failingPhase?: string;
  channelDriftWarning?: string | null;
}

async function emitChannelDriftWarning(
  workspaceRoot: string,
  systemId: string,
  devReleaseId: string,
): Promise<string | null> {
  try {
    const state = await readSystemStateSmart(workspaceRoot, systemId);
    const altRelease = state.lastPropagated?.alt?.releaseId;
    const mainRelease = state.lastPropagated?.main?.releaseId;
    const driftChannels: string[] = [];
    if (altRelease && altRelease !== devReleaseId) {
      driftChannels.push(`alt=${altRelease}`);
    }
    if (mainRelease && mainRelease !== devReleaseId) {
      driftChannels.push(`main=${mainRelease}`);
    }
    if (driftChannels.length === 0) return null;
    return `Channel drift: dev=${devReleaseId}, ${driftChannels.join(", ")} — run leitstand.propagate + leitstand.promote to align`;
  } catch {
    return null;
  }
}

export async function runLeitstandDevDeploy(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<DevDeployResult>> {
  const systemId = flagSite(input);
  if (!systemId) throw new Error("[leitstand.dev-deploy] --site is required");
  const releaseId = flagString(input, "release");
  const gateDecisionFlag = flagString(input, "gate-decision");
  const candidateId = flagString(input, "candidate-id") ?? systemId;
  const artifactHashFlag = flagString(input, "artifact-hash");

  if (!releaseId) {
    throw new Error("[leitstand.dev-deploy] --release is required");
  }
  const cacheCloneDir = resolveCacheClonePath(context.workspaceRoot, systemId);
  const gateDecisionPath = resolveGateDecisionPath(
    cacheCloneDir,
    releaseId,
    "dev",
    gateDecisionFlag,
  );

  const releaseDir = releaseId
    ? path.join(context.workspaceRoot, "releases", releaseId)
    : undefined;
  const artifactHash = await resolveArtifactHash(artifactHashFlag, releaseDir);

  const authResult = await authorizeAndDeploy({
    gateDecisionPath,
    artifactHash,
    candidateId,
    gate: "dev-deploy",
    durableSyncVerified: false,
    artifactReadinessVerified: true,
    forceRequested: false,
    skipRequested: false,
    waiverRequested: false,
    graceRequested: false,
  });

  if (!authResult.ok) {
    return {
      data: {
        systemId,
        channel: "dev",
        releaseId: releaseId ?? "",
        deploymentUrl: "",
        state: "failed",
        buildIdentityVerified: false,
        testEvidenceVerified: false,
      },
      summary: `[leitstand.dev-deploy] denied: ${authResult.outcome.ruleId} — ${authResult.outcome.message}`,
      exitCode: 1,
      diagnostics: [
        {
          ruleId: authResult.outcome.ruleId,
          severity: "error",
          message: authResult.outcome.message,
          evidence: [],
        },
      ],
    } as unknown as KernelCommandResult<DevDeployResult>;
  }

  const operationId = generateOperationId();
  const now = new Date().toISOString();
  const effectRecord = buildEffectRecord(
    operationId,
    candidateId,
    "dev-deploy",
    "dev",
    artifactHash,
    authResult.outcome.decisionId,
    false,
    null,
    "authorized",
    now,
  );
  await writeDeploymentEffectRecord(cacheCloneDir, effectRecord);

  const { adapter, systemConfig: depConfig } = await prepareDeployContext(
    context.workspaceRoot,
    systemId,
    "leitstand.dev-deploy",
  );
  const channelConfig = depConfig.channels.dev;
  const secretsFilePath = resolveSecretsFilePath(context.workspaceRoot, channelConfig);

  const { missionId, commitSha } = await resolveMissionContext(context.workspaceRoot, systemId);

  const { executeDeployPhases } = await import("./deploy-execution.ts");
  const deployResult = await executeDeployPhases(
    {
      systemId,
      releaseId,
      candidateId,
      artifactHash,
      authResult,
      workspaceRoot: context.workspaceRoot,
      cacheCloneDir,
      systemConfig: depConfig,
      adapter,
      operationId,
      gateDecisionPath,
      secretsFilePath,
      skipEvidenceSync: Boolean(flagString(input, "skip-evidence-sync")),
      forceBuild: Boolean(input.flags["force-build"]),
      missionId,
      commitSha,
    },
    "dev",
  );

  const driftWarning = deployResult.failingPhase
    ? null
    : await emitChannelDriftWarning(context.workspaceRoot, systemId, releaseId);

  return {
    data: {
      command: "leitstand.dev-deploy",
      systemId,
      missionId,
      commitSha,
      buildState: deployResult.failingPhase === "build" ? "failed" : "succeeded",
      buildSkipped: deployResult.buildSkipped,
      deployState: deployResult.failingPhase ? "failed" : "succeeded",
      deploymentUrl: deployResult.deploymentUrl,
      buildIdentity: deployResult.buildIdentity,
      axiom: {
        status: "not-run" as const,
        errors: 0,
        warnings: 0,
        exitCode: 0,
        freshness: deployResult.freshness,
      },
      evidenceSynced: deployResult.evidenceSynced,
      evidenceSyncError: deployResult.evidenceSyncError,
      releaseDeployed: releaseId,
      failingPhase: deployResult.failingPhase,
      channelDriftWarning: driftWarning,
    },
    summary: deployResult.failingPhase
      ? `[leitstand.dev-deploy] failed at phase: ${deployResult.failingPhase}`
      : driftWarning
        ? `[leitstand.dev-deploy] deployed to dev: ${deployResult.deploymentUrl} — WARN: ${driftWarning}`
        : `[leitstand.dev-deploy] deployed to dev: ${deployResult.deploymentUrl}`,
    exitCode: deployResult.failingPhase ? 1 : 0,
    nextSteps: deployResult.failingPhase
      ? [
          {
            action: `Fix the failing phase (${deployResult.failingPhase}), then re-run: pnpm exec werkstatt run leitstand.dev-deploy --site ${systemId} --release ${releaseId}`,
            kind: "required",
          },
        ]
      : driftWarning
        ? [
            {
              action: `Propagate to alt: pnpm exec werkstatt run leitstand.propagate --site ${systemId} --release ${releaseId}`,
              kind: "required",
            },
            {
              action: `Promote to main: pnpm exec werkstatt run leitstand.promote --site ${systemId} --release ${releaseId}`,
              kind: "required",
            },
          ]
        : [
            {
              action: `Propagate to alt: pnpm exec werkstatt run leitstand.propagate --site ${systemId} --release ${releaseId}`,
              kind: "optional",
            },
          ],
  } as unknown as KernelCommandResult<DevDeployResult>;
}

// §5.1: leitstand.propagate (RFC-0628: requires published + Axiom evidence gate with commitSha+missionId match)
export interface LeitstandPropagateData {
  systemId: string;
  releaseId: string;
  channel: "alt";
  state: "succeeded" | "failed" | "failed-stale" | "in-progress";
  deploymentUrl: string;
  startedAt: string;
  completedAt: string | null;
  preflight: { passed: boolean; checks: PreflightCheck[] };
  purgeResult?: PurgeResult;
  health: { state: "healthy" | "unhealthy" | "unknown"; checks: HealthCheck[] };
  smokeResult?: SmokeRunResult;
  releaseState: "alt-deployed";
  devBuildIdentityVerified: boolean;
  axiomEvidenceVerified: boolean;
  testEvidenceVerified: boolean;
  failingPhase?: string;
}

export async function runLeitstandPropagate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<LeitstandPropagateData>> {
  const releaseId = flagString(input, "release");
  if (!releaseId) throw new Error("[leitstand.propagate] --release is required");
  const systemId = flagSite(input);
  if (!systemId) throw new Error("[leitstand.propagate] --site is required");
  const gateDecisionFlag = flagString(input, "gate-decision");
  const candidateId = flagString(input, "candidate-id") ?? systemId;
  const artifactHashFlag = flagString(input, "artifact-hash");

  const cacheCloneDir = resolveCacheClonePath(context.workspaceRoot, systemId);
  const gateDecisionPath = resolveGateDecisionPath(
    cacheCloneDir,
    releaseId,
    "alt",
    gateDecisionFlag,
  );

  const releaseDir = path.join(context.workspaceRoot, "releases", releaseId);
  const artifactHash = await resolveArtifactHash(artifactHashFlag, releaseDir);

  const r2Config = makeR2ConfigFromEnv(process.env as Record<string, string | undefined>);
  let durableSyncVerified = !r2Config;
  if (r2Config) {
    durableSyncVerified = await verifyDurableSync(artifactHash, r2Config);
  }

  const authResult = await authorizeAndDeploy({
    gateDecisionPath,
    artifactHash,
    candidateId,
    gate: "propagate-alt",
    durableSyncVerified,
    artifactReadinessVerified: true,
    forceRequested: false,
    skipRequested: false,
    waiverRequested: false,
    graceRequested: false,
  });

  if (!authResult.ok) {
    return {
      data: {
        releaseId,
        systemId,
        channel: "alt",
        deploymentUrl: "",
        state: "failed",
        releaseState: "",
        devBuildIdentityVerified: false,
      },
      summary: `[leitstand.propagate] denied: ${authResult.outcome.ruleId} — ${authResult.outcome.message}`,
      exitCode: 1,
      diagnostics: [
        {
          ruleId: authResult.outcome.ruleId,
          severity: "error",
          message: authResult.outcome.message,
          evidence: [],
        },
      ],
    } as unknown as KernelCommandResult<LeitstandPropagateData>;
  }

  const operationId = generateOperationId();
  const now = new Date().toISOString();
  const effectRecord = buildEffectRecord(
    operationId,
    candidateId,
    "propagate-alt",
    "alt",
    artifactHash,
    authResult.outcome.decisionId,
    durableSyncVerified,
    null,
    "authorized",
    now,
  );
  await writeDeploymentEffectRecord(cacheCloneDir, effectRecord);

  const { adapter, systemConfig: depConfig } = await prepareDeployContext(
    context.workspaceRoot,
    systemId,
    "leitstand.propagate",
  );
  const channelConfig = depConfig.channels.alt;
  const secretsFilePath = resolveSecretsFilePath(context.workspaceRoot, channelConfig);

  const { missionId, commitSha } = await resolveMissionContext(context.workspaceRoot, systemId);

  const { executeDeployPhases } = await import("./deploy-execution.ts");
  const deployResult = await executeDeployPhases(
    {
      systemId,
      releaseId,
      candidateId,
      artifactHash,
      authResult,
      workspaceRoot: context.workspaceRoot,
      cacheCloneDir,
      systemConfig: depConfig,
      adapter,
      operationId,
      gateDecisionPath,
      secretsFilePath,
      missionId,
      commitSha,
    },
    "alt",
  );

  return {
    data: {
      releaseId,
      systemId,
      channel: "alt",
      deploymentUrl: deployResult.deploymentUrl,
      state: deployResult.failingPhase ? "failed" : "succeeded",
      startedAt: now,
      completedAt: new Date().toISOString(),
      preflight: { passed: !deployResult.failingPhase, checks: [] },
      health: {
        state: deployResult.healthState,
        checks: deployResult.healthChecks,
      },
      purgeResult: deployResult.purgeResult,
      releaseState: "alt-deployed",
      devBuildIdentityVerified: deployResult.freshness.verified,
      axiomEvidenceVerified: !deployResult.failingPhase,
      testEvidenceVerified: deployResult.evidenceSynced,
      failingPhase: deployResult.failingPhase,
    },
    summary: deployResult.failingPhase
      ? `[leitstand.propagate] failed at phase: ${deployResult.failingPhase}${deployResult.errorMessage ? ` — ${deployResult.errorMessage}` : ""}`
      : `[leitstand.propagate] deployed to alt: ${deployResult.deploymentUrl}`,
    exitCode: deployResult.failingPhase ? 1 : 0,
    nextSteps: deployResult.failingPhase
      ? [
          {
            action: `Fix the failing phase (${deployResult.failingPhase}), then re-run: pnpm exec werkstatt run leitstand.propagate --site ${systemId} --release ${releaseId}`,
            kind: "required",
          },
        ]
      : [
          {
            action: `Certify the alt gate: pnpm exec werkstatt run leitstand.certify --site ${systemId} --release ${releaseId} --gate alt`,
            kind: "optional",
          },
          {
            action: `Promote to main: pnpm exec werkstatt run leitstand.promote --site ${systemId} --release ${releaseId}`,
            kind: "optional",
          },
        ],
  } as unknown as KernelCommandResult<LeitstandPropagateData>;
}

// §5.1b: leitstand.promote (RFC-0608: alt→main with build-identity verification)
export interface LeitstandPromoteData {
  systemId: string;
  releaseId: string;
  channel: "main";
  state: "succeeded" | "failed";
  deploymentUrl: string;
  buildIdentityVerified: boolean;
  testEvidenceVerified: boolean;
  purgeResult?: PurgeResult;
  healthState: "healthy" | "unhealthy" | "unknown";
  smokeResult?: SmokeRunResult;
  releaseState: "promoted";
  failingPhase?: string;
}

export async function runLeitstandPromote(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<LeitstandPromoteData>> {
  const releaseId = flagString(input, "release");
  if (!releaseId) throw new Error("[leitstand.promote] --release is required");
  const systemId = flagSite(input);
  if (!systemId) throw new Error("[leitstand.promote] --site is required");
  const gateDecisionFlag = flagString(input, "gate-decision");
  const candidateId = flagString(input, "candidate-id") ?? systemId;
  const artifactHashFlag = flagString(input, "artifact-hash");

  const cacheCloneDir = resolveCacheClonePath(context.workspaceRoot, systemId);
  const gateDecisionsDir = path.join(cacheCloneDir, "gate-decisions");
  const mainVerificationFlag = flagString(input, "main-verification-decision");
  const mainVerificationPath = mainVerificationFlag
    ? path.isAbsolute(mainVerificationFlag) || path.parse(mainVerificationFlag).dir !== ""
      ? mainVerificationFlag
      : path.join(gateDecisionsDir, mainVerificationFlag)
    : path.join(gateDecisionsDir, `${releaseId}-main-verification.json`);

  const gateDecisionPath = resolveGateDecisionPath(
    cacheCloneDir,
    releaseId,
    "main",
    gateDecisionFlag,
  );

  const releaseDir = path.join(context.workspaceRoot, "releases", releaseId);
  const artifactHash = await resolveArtifactHash(artifactHashFlag, releaseDir);

  const r2Config = makeR2ConfigFromEnv(process.env as Record<string, string | undefined>);
  let durableSyncVerified = !r2Config;
  if (r2Config) {
    durableSyncVerified = await verifyDurableSync(artifactHash, r2Config);
  }

  const { authorization, mainVerification } = await authorizeMainPromotion(
    gateDecisionPath,
    mainVerificationPath,
    artifactHash,
    candidateId,
    durableSyncVerified,
    false,
    false,
    false,
    false,
  );

  if (!authorization.ok) {
    return {
      data: {
        releaseId,
        systemId,
        channel: "main",
        deploymentUrl: "",
        state: "failed",
        buildIdentityVerified: false,
        testEvidenceVerified: false,
        healthState: "unknown",
        releaseState: "promoted",
      },
      summary: `[leitstand.promote] denied: ${authorization.outcome.ruleId} — ${authorization.outcome.message}`,
      exitCode: 1,
      diagnostics: [
        {
          ruleId: authorization.outcome.ruleId,
          severity: "error",
          message: authorization.outcome.message,
          evidence: [],
        },
      ],
    } as unknown as KernelCommandResult<LeitstandPromoteData>;
  }

  const operationId = generateOperationId();
  const now = new Date().toISOString();
  const mainVerificationDecisionId = mainVerification.ok ? mainVerification.decisionId : null;
  const effectRecord = buildEffectRecord(
    operationId,
    candidateId,
    "promote-main",
    "main",
    artifactHash,
    authorization.outcome.decisionId,
    durableSyncVerified,
    mainVerificationDecisionId,
    "authorized",
    now,
  );
  await writeDeploymentEffectRecord(cacheCloneDir, effectRecord);

  const { adapter, systemConfig: depConfig } = await prepareDeployContext(
    context.workspaceRoot,
    systemId,
    "leitstand.promote",
  );
  const channelConfig = depConfig.channels.main;
  const secretsFilePath = resolveSecretsFilePath(context.workspaceRoot, channelConfig);

  // RFC-0896: Register custom domain DNS + Workers route and www → apex redirect
  // before deploying to the main channel. Both commands are idempotent.
  try {
    const { runCustomdomainRegister } = await import("../customdomain/customdomain-register.ts");
    const { runRedirectRegister } = await import("../customdomain/redirect-register.ts");
    const customdomainInput: KernelCommandInput = {
      flags: { site: systemId },
      argv: [],
    };
    await runCustomdomainRegister(customdomainInput, context);
    await runRedirectRegister(customdomainInput, context);
  } catch (err) {
    return {
      data: {
        releaseId,
        systemId,
        channel: "main",
        deploymentUrl: "",
        state: "failed",
        buildIdentityVerified: false,
        testEvidenceVerified: false,
        healthState: "unknown",
        releaseState: "promoted",
        failingPhase: "custom-domain-setup",
      },
      summary: `[leitstand.promote] custom domain setup failed: ${err instanceof Error ? err.message : String(err)}`,
      exitCode: 1,
    } as unknown as KernelCommandResult<LeitstandPromoteData>;
  }

  const { executeDeployPhases } = await import("./deploy-execution.ts");
  const deployResult = await executeDeployPhases(
    {
      systemId,
      releaseId,
      candidateId,
      artifactHash,
      authResult: authorization,
      workspaceRoot: context.workspaceRoot,
      cacheCloneDir,
      systemConfig: depConfig,
      adapter,
      operationId,
      gateDecisionPath,
      secretsFilePath,
    },
    "main",
  );

  return {
    data: {
      releaseId,
      systemId,
      channel: "main",
      deploymentUrl: deployResult.deploymentUrl,
      state: deployResult.failingPhase ? "failed" : "succeeded",
      buildIdentityVerified: deployResult.freshness.verified,
      testEvidenceVerified: deployResult.evidenceSynced,
      purgeResult: deployResult.purgeResult,
      healthState: deployResult.healthState,
      releaseState: "promoted",
      failingPhase: deployResult.failingPhase,
    },
    summary: deployResult.failingPhase
      ? `[leitstand.promote] failed at phase: ${deployResult.failingPhase}`
      : `[leitstand.promote] promoted to main: ${deployResult.deploymentUrl}`,
    exitCode: deployResult.failingPhase ? 1 : 0,
    nextSteps: deployResult.failingPhase
      ? [
          {
            action: `Fix the failing phase (${deployResult.failingPhase}), then re-run: pnpm exec werkstatt run leitstand.promote --site ${systemId} --release ${releaseId}`,
            kind: "required",
          },
        ]
      : [
          {
            action: `Verify health: pnpm exec werkstatt run leitstand.health --site ${systemId} --channel main`,
            kind: "optional",
          },
          {
            action: `Close the mission: pnpm exec werkstatt run mission.close --mission <mission-id>`,
            kind: "optional",
          },
        ],
  } as unknown as KernelCommandResult<LeitstandPromoteData>;
}

// §5.2: leitstand.status
export interface LeitstandStatusData {
  systemId: string;
  channels: {
    dev?: {
      releaseId: string;
      state: string;
      healthy: boolean;
      at: string;
      purgeResult?: PurgeResult;
    } | null;
    alt?: {
      releaseId: string;
      state: string;
      healthy: boolean;
      at: string;
      purgeResult?: PurgeResult;
    } | null;
    main?: {
      releaseId: string;
      state: string;
      healthy: boolean;
      at: string;
      purgeResult?: PurgeResult;
    } | null;
  };
}

export async function runLeitstandStatus(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<LeitstandStatusData>> {
  const systemId = flagSite(input);
  if (!systemId) throw new Error("[leitstand.status] --site is required");

  const cacheCloneDir = resolveCacheClonePath(context.workspaceRoot, systemId);
  const opsDir = path.join(cacheCloneDir, "deployment-operations");
  const channels: LeitstandStatusData["channels"] = {};

  for (const ch of ["dev", "alt", "main"] as const) {
    try {
      const entries = await fs.readdir(opsDir).catch(() => []);
      const channelRecords = entries
        .filter((f) => f.endsWith(".json"))
        .map((f) => path.join(opsDir, f));

      let latest: {
        releaseId: string;
        state: string;
        at: string;
        purgeResult?: PurgeResult;
      } | null = null;
      for (const recordPath of channelRecords) {
        try {
          const content = await fs.readFile(recordPath, "utf8");
          const record = JSON.parse(content);
          if (record.channel === ch) {
            const at = record.timestamp ?? "";
            if (!latest || at > latest.at) {
              latest = {
                releaseId: record.candidateId ?? record.operationId ?? "",
                state: record.state ?? "",
                at,
                purgeResult: record.purgeResult,
              };
            }
          }
        } catch {
          // Skip malformed records
        }
      }

      if (latest) {
        channels[ch] = {
          releaseId: latest.releaseId,
          state: latest.state,
          healthy: latest.state === "succeeded",
          at: latest.at,
          purgeResult: latest.purgeResult,
        };
      } else {
        channels[ch] = null;
      }
    } catch {
      channels[ch] = null;
    }
  }

  return {
    data: { systemId, channels },
    summary: `[leitstand.status] ${systemId}: dev=${channels.dev?.state ?? "none"} alt=${channels.alt?.state ?? "none"} main=${channels.main?.state ?? "none"}`,
    exitCode: 0,
    nextSteps: [
      {
        action: `Check pipeline state: pnpm exec werkstatt run leitstand.pipeline.check --site ${systemId}`,
        kind: "optional",
      },
    ],
  };
}

// §5.3: leitstand.rollback (RFC-0895: native wrangler rollback, unified site+service)
// RFC-0926: release-aware rollback with --to-release and Worker Version ID tracking

interface ResolvedRollbackTarget {
  versionId?: string;
  releaseId?: string;
}

async function resolveRollbackVersionId(
  cacheCloneDir: string,
  channel: Channel,
  targetRelease?: string,
): Promise<ResolvedRollbackTarget> {
  const opsDir = join(cacheCloneDir, "deployment-operations");
  if (!existsSync(opsDir)) return {};

  const files = readdirSync(opsDir).filter((f) => f.endsWith(".json"));
  const records: Array<{
    workerVersionId?: string;
    releaseId?: string;
    state: string;
    channel?: string;
    timestamp: string;
  }> = [];

  for (const file of files) {
    try {
      const content = await fs.readFile(join(opsDir, file), "utf8");
      const parsed = JSON.parse(content);
      if (parsed.state === "succeeded" && parsed.workerVersionId) {
        records.push({
          workerVersionId: parsed.workerVersionId,
          releaseId: parsed.releaseId,
          state: parsed.state,
          channel: parsed.channel,
          timestamp: parsed.timestamp,
        });
      }
    } catch {
      // Skip malformed files
    }
  }

  // Sort by timestamp descending (most recent first)
  records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (targetRelease) {
    // Find the most recent succeeded record for the target release
    const match = records.find((r) => r.releaseId === targetRelease);
    if (match?.workerVersionId) {
      return { versionId: match.workerVersionId, releaseId: match.releaseId };
    }
    return {};
  }

  // Default: find the previous release (different from the current release in system-state)
  const state = await readSystemStateSmart(cacheCloneDir, path.basename(cacheCloneDir));
  const currentReleaseId = state?.lastPropagated?.[channel]?.releaseId;

  if (!currentReleaseId) return {};

  // Find the most recent succeeded record with a different releaseId
  const match = records.find((r) => r.releaseId && r.releaseId !== currentReleaseId);
  if (match?.workerVersionId) {
    return { versionId: match.workerVersionId, releaseId: match.releaseId };
  }

  return {};
}

export interface LeitstandRollbackData {
  command: "leitstand.rollback";
  target: "site" | "service";
  systemId?: string;
  serviceId?: string;
  channel?: Channel;
  workerName: string;
  rollbackState: "succeeded" | "failed";
  rolledBackToVersionId?: string;
  rolledBackToReleaseId?: string;
  startedAt: string;
  completedAt: string;
  operationId: string;
  purgeResult?: PurgeResult;
}

export async function runLeitstandRollback(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<LeitstandRollbackData>> {
  const { workspaceRoot, logger } = context;
  const siteId = flagSite(input);
  const serviceId = flagString(input, "service");
  const channel = parseChannel(flagString(input, "channel"), "main");
  const toRelease = flagString(input, "to-release");

  // Reject removed flags
  if (flagString(input, "gate-decision")) {
    throw new Error(
      "[leitstand.rollback] --gate-decision is no longer supported for rollback (RFC-0895)",
    );
  }

  // Exactly one of --site or --service required
  if (!siteId && !serviceId) {
    throw new Error("[leitstand.rollback] --site or --service is required");
  }
  if (siteId && serviceId) {
    throw new Error("[leitstand.rollback] --site and --service are mutually exclusive");
  }

  const operationId = generateOperationId();
  const startedAt = new Date().toISOString();

  if (siteId) {
    return runSiteRollback(
      workspaceRoot,
      siteId,
      channel,
      operationId,
      startedAt,
      logger,
      toRelease,
    );
  } else {
    return runServiceRollback(workspaceRoot, serviceId!, operationId, startedAt, logger, toRelease);
  }
}

async function runSiteRollback(
  workspaceRoot: string,
  systemId: string,
  channel: Channel,
  operationId: string,
  startedAt: string,
  logger: { info: (msg: string) => void },
  toRelease?: string,
): Promise<KernelCommandResult<LeitstandRollbackData>> {
  const systemConfig = await readSystemConfigSmart(workspaceRoot, systemId);
  if (!systemConfig.deployment) {
    throw new Error(
      `[leitstand.rollback] system '${systemId}' has no deployment config in system-config.yaml`,
    );
  }

  const channelConfig =
    channel === "dev"
      ? systemConfig.deployment.channels.dev
      : channel === "alt"
        ? systemConfig.deployment.channels.alt
        : systemConfig.deployment.channels.main;

  const workerName = channelConfig?.workerName ?? systemId;
  const channelUrl = channelConfig?.url ?? "";

  // Resolve Worker Version ID for targeted rollback (RFC-0926)
  const cacheCloneDir = resolveCacheClonePath(workspaceRoot, systemId);
  const rollbackTarget = await resolveRollbackVersionId(cacheCloneDir, channel, toRelease);
  if (rollbackTarget.versionId) {
    logger.info(
      `[leitstand.rollback] resolved Worker Version ID ${rollbackTarget.versionId} for release ${rollbackTarget.releaseId ?? toRelease ?? "previous"}`,
    );
  } else if (toRelease) {
    logger.info(
      `[leitstand.rollback] no stored Worker Version ID for release '${toRelease}', falling back to wrangler rollback without version ID`,
    );
  } else {
    logger.info(
      `[leitstand.rollback] no previous release version ID found, falling back to wrangler rollback without version ID`,
    );
  }

  // Create temp directory with minimal wrangler.json for wrangler rollback
  const os = await import("node:os");
  const tmpDir = await fs.mkdtemp(join(os.tmpdir(), "wrangler-rollback-"));
  const wranglerConfigPath = join(tmpDir, "wrangler.json");
  await fs.writeFile(wranglerConfigPath, JSON.stringify({ name: workerName }));

  try {
    logger.info(
      `[leitstand.rollback] rolling back ${workerName} (channel=${channel}) via wrangler rollback…`,
    );

    const adapter = resolveAdapter(systemConfig.deployment.adapter);
    const rollbackResult = await adapter.rollback({
      systemId,
      channel,
      wranglerConfigDir: tmpDir,
      workerName,
      versionId: rollbackTarget.versionId,
    });

    // Purge CDN cache for site rollbacks
    let purgeResult: PurgeResult | undefined;
    if (rollbackResult.state === "succeeded" && channelUrl) {
      const secretsEnv = channelConfig?.secretsFile
        ? await sourceDotenv(join(workspaceRoot, channelConfig.secretsFile))
        : {};
      const env = { ...filterEnv(process.env), ...secretsEnv };
      const zoneId = env["CLOUDFLARE_ZONE_ID"];
      const apiToken = env["CLOUDFLARE_API_TOKEN"];
      if (zoneId && apiToken) {
        const urls = collectPurgeUrls(channelUrl, []);
        purgeResult = await purgeCacheByUrls(zoneId, apiToken, urls);
      }
    }

    // Write deployment effect record
    const effectRecord = buildEffectRecord(
      operationId,
      systemId,
      "dev-deploy",
      channel,
      "" as Sha256Digest,
      operationId,
      false,
      null,
      rollbackResult.state === "succeeded" ? "rolled-back" : "failed",
      new Date().toISOString(),
      rollbackTarget.versionId,
      rollbackTarget.releaseId,
    );
    await writeDeploymentEffectRecord(cacheCloneDir, effectRecord);

    const completedAt = new Date().toISOString();
    const data: LeitstandRollbackData = {
      command: "leitstand.rollback",
      target: "site",
      systemId,
      channel,
      workerName,
      rollbackState: rollbackResult.state,
      rolledBackToVersionId: rollbackTarget.versionId,
      rolledBackToReleaseId: rollbackTarget.releaseId,
      startedAt,
      completedAt,
      operationId,
      purgeResult,
    };

    if (rollbackResult.state === "failed") {
      return {
        data,
        summary: `[leitstand.rollback] ${systemId}: wrangler rollback failed — ${rollbackResult.stderr.slice(-200)}`,
        exitCode: 1,
        nextSteps: [
          {
            action: `Check wrangler logs and re-run: pnpm exec werkstatt run leitstand.rollback --site ${systemId}`,
            kind: "required",
          },
        ],
      } as unknown as KernelCommandResult<LeitstandRollbackData>;
    }

    return {
      data,
      summary: `[leitstand.rollback] ${systemId}: rolled back to ${rollbackTarget.releaseId ?? "previous deployment"}${rollbackTarget.versionId ? ` (version ${rollbackTarget.versionId})` : ""}`,
      nextSteps: [
        {
          action: `Verify health: pnpm exec werkstatt run leitstand.health --site ${systemId} --channel ${channel}`,
          kind: "optional",
        },
      ],
    } as unknown as KernelCommandResult<LeitstandRollbackData>;
  } finally {
    // Clean up temp directory
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runServiceRollback(
  workspaceRoot: string,
  serviceId: string,
  operationId: string,
  startedAt: string,
  logger: { info: (msg: string) => void },
  _toRelease?: string,
): Promise<KernelCommandResult<LeitstandRollbackData>> {
  const { readServicesRegistry, findServiceEntry } = await import("../sternsystem/registry-io.ts");
  const {
    runWranglerRollback,
    parseEnvFile,
    acquireServiceLock,
    releaseServiceLock,
    recordProdDeployState,
  } = await import("./service-deploy-helpers.ts");

  const registry = await readServicesRegistry(workspaceRoot);
  const serviceEntry = findServiceEntry(registry, serviceId);
  if (!serviceEntry) {
    throw new Error(
      `[leitstand.rollback] service '${serviceId}' not found in services/registry.yaml`,
    );
  }

  const serviceDir = join(workspaceRoot, "services", serviceId);
  if (!existsSync(serviceDir)) {
    throw new Error(`[leitstand.rollback] services/${serviceId}/ does not exist`);
  }

  const wranglerPath = join(serviceDir, "wrangler.jsonc");
  if (!existsSync(wranglerPath)) {
    throw new Error(
      `[leitstand.rollback] services/${serviceId}/wrangler.jsonc not found — not a Cloudflare Worker service`,
    );
  }

  await acquireServiceLock(workspaceRoot, serviceId, operationId, "leitstand.rollback");

  try {
    const envPath = join(serviceDir, ".env");
    const deployEnv = await parseEnvFile(envPath);

    logger.info(
      `[leitstand.rollback] rolling back ${serviceEntry.workerName} via wrangler rollback…`,
    );
    const wranglerResult = await runWranglerRollback(serviceDir, deployEnv);

    if (wranglerResult.exitCode !== 0) {
      const completedAt = new Date().toISOString();
      return {
        data: {
          command: "leitstand.rollback",
          target: "service",
          serviceId,
          workerName: serviceEntry.workerName,
          rollbackState: "failed",
          startedAt,
          completedAt,
          operationId,
        },
        summary: `[leitstand.rollback] ${serviceId}: wrangler rollback failed — ${wranglerResult.stderr.slice(-200)}`,
        exitCode: 1,
        nextSteps: [
          {
            action: `Check wrangler logs and re-run: pnpm exec werkstatt run leitstand.rollback --service ${serviceId}`,
            kind: "required",
          },
        ],
      } as unknown as KernelCommandResult<LeitstandRollbackData>;
    }

    await recordProdDeployState(workspaceRoot, serviceId, {
      at: new Date().toISOString(),
      state: "rolled-back",
      operationId,
    });

    const completedAt = new Date().toISOString();
    return {
      data: {
        command: "leitstand.rollback",
        target: "service",
        serviceId,
        workerName: serviceEntry.workerName,
        rollbackState: "succeeded",
        startedAt,
        completedAt,
        operationId,
      },
      summary: `[leitstand.rollback] ${serviceId}: rolled back to previous deployment`,
      nextSteps: [
        {
          action: `Verify service health: pnpm exec werkstatt run leitstand.health --service ${serviceId}`,
          kind: "optional",
        },
      ],
    } as unknown as KernelCommandResult<LeitstandRollbackData>;
  } finally {
    await releaseServiceLock(workspaceRoot, serviceId);
  }
}

// §5.4: leitstand.health
export interface LeitstandHealthData {
  systemId: string;
  channel: Channel;
  state: "healthy" | "unhealthy" | "unknown";
  checks: HealthCheck[];
}

export async function runLeitstandHealth(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<LeitstandHealthData>> {
  const systemId = flagSite(input);
  if (!systemId) throw new Error("[leitstand.health] --site is required");
  const channel = parseChannel(flagString(input, "channel"), "alt");

  const systemConfig = await readSystemConfigSmart(context.workspaceRoot, systemId);
  if (!systemConfig.deployment) {
    return {
      data: { systemId, channel, state: "unknown", checks: [] },
      summary: `[leitstand.health] ${systemId}: no deployment config`,
      exitCode: 0,
    };
  }
  const adapter = resolveAdapter(systemConfig.deployment.adapter);
  const channelConfig =
    channel === "dev"
      ? systemConfig.deployment.channels.dev
      : channel === "alt"
        ? systemConfig.deployment.channels.alt
        : systemConfig.deployment.channels.main;

  if (!channelConfig) {
    return {
      data: { systemId, channel, state: "unknown", checks: [] },
      summary: `[leitstand.health] ${systemId}: channel ${channel} not configured`,
      exitCode: 0,
    };
  }

  try {
    const result = await adapter.health({
      systemId,
      deploymentUrl: channelConfig.url,
      channel,
      releaseId: "",
      expectedBehaviorSnapshotHash: "",
      workspaceRoot: context.workspaceRoot,
    });
    return {
      data: {
        systemId,
        channel,
        state: result.state ?? "unknown",
        checks: result.checks ?? [],
      },
      summary: `[leitstand.health] ${systemId} channel=${channel}: state=${result.state ?? "unknown"}`,
      exitCode: 0,
    };
  } catch (err) {
    return {
      data: { systemId, channel, state: "unhealthy", checks: [] },
      summary: `[leitstand.health] ${systemId} channel=${channel}: error=${err instanceof Error ? err.message : String(err)}`,
      exitCode: 0,
    };
  }
}

export interface PipelineCheckResult {
  command: "leitstand.pipeline.check";
  releaseId: string;
  systemId: string;
  releaseState: string;
  steps: Array<{
    step: string;
    status: "done" | "pending" | "blocked";
    detail?: string;
  }>;
  nextStep: string | null;
}

function determineNextStep(releaseState: string): string {
  switch (releaseState) {
    case "prepared":
      return "release.ready";
    case "ready":
      return "leitstand.dev-deploy";
    case "dev-deployed":
      return "leitstand.propagate";
    case "alt-deployed":
      return "leitstand.promote";
    case "main-deployed":
      return "done";
    case "failed":
      return "leitstand.rollback";
    default:
      return "release.prepare";
  }
}

export async function runLeitstandPipelineCheck(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<PipelineCheckResult>> {
  const releaseId = flagString(input, "release");
  if (!releaseId) {
    throw new Error("[leitstand.pipeline.check] --release is required");
  }
  const systemId = flagSite(input) ?? "";

  const cacheCloneDir = resolveCacheClonePath(context.workspaceRoot, systemId);
  const opsDir = path.join(cacheCloneDir, "deployment-operations");

  const channelStates: Record<string, { state: string; at: string }> = {};
  try {
    const entries = await fs.readdir(opsDir);
    for (const f of entries) {
      if (!f.endsWith(".json")) continue;
      try {
        const record = JSON.parse(await fs.readFile(path.join(opsDir, f), "utf8"));
        const ch = record.channel as string | undefined;
        if (!ch) continue;
        const at = record.timestamp ?? "";
        if (!channelStates[ch] || at > channelStates[ch].at) {
          channelStates[ch] = { state: record.state ?? "", at };
        }
      } catch {
        // skip
      }
    }
  } catch {
    // ops dir doesn't exist yet
  }

  const devState = channelStates["dev"]?.state;
  const altState = channelStates["alt"]?.state;
  const mainState = channelStates["main"]?.state;

  const steps: PipelineCheckResult["steps"] = [
    { step: "release.prepare", status: "done", detail: "release prepared" },
    { step: "release.ready", status: "done", detail: "release ready" },
    {
      step: "leitstand.dev-deploy",
      status: devState === "succeeded" ? "done" : devState === "failed" ? "blocked" : "pending",
      detail: devState ? `state=${devState}` : "awaiting gate decision",
    },
    {
      step: "leitstand.propagate",
      status: altState === "succeeded" ? "done" : altState === "failed" ? "blocked" : "pending",
      detail: altState ? `state=${altState}` : "awaiting dev-deploy + R2 durable sync",
    },
    {
      step: "leitstand.promote",
      status: mainState === "succeeded" ? "done" : mainState === "failed" ? "blocked" : "pending",
      detail: mainState ? `state=${mainState}` : "awaiting propagate-alt + main verification",
    },
  ];

  let releaseState = "ready";
  if (mainState === "succeeded") releaseState = "main-deployed";
  else if (altState === "succeeded") releaseState = "alt-deployed";
  else if (devState === "succeeded") releaseState = "dev-deployed";
  else if (devState === "failed" || altState === "failed" || mainState === "failed")
    releaseState = "failed";

  return {
    data: {
      command: "leitstand.pipeline.check",
      releaseId,
      systemId,
      releaseState,
      steps,
      nextStep: determineNextStep(releaseState),
    },
    summary: `[leitstand.pipeline.check] release=${releaseId}: state=${releaseState} next=${determineNextStep(releaseState)}`,
    exitCode: 0,
    nextSteps: [
      {
        action: determineNextStep(releaseState),
        kind: "optional",
      },
    ],
  };
}

export interface HotfixDevDeployResult {
  command: "leitstand.hotfix.dev-deploy";
  systemId: string;
  missionId: string;
  releaseId: string;
  phases: {
    commit: { skipped: boolean; commitSha?: string };
    validate: { mode: "postbuild" | "full"; passed: boolean };
    reconcile: { ok: boolean };
    close: { ok: boolean };
    release: { releaseId: string; prepared: boolean; ready: boolean };
    certify: { gate: "dev"; decision: string; passed: boolean };
    deploy: { url: string; deployed: boolean };
  };
  deploymentUrl: string;
  failingPhase?: string;
}

async function runPhase(
  workspaceRoot: string,
  commandName: string,
  argv: string[],
  logger: { info: (m: string) => void },
): Promise<{ exitCode: number; data?: Record<string, unknown>; summary?: string }> {
  // Pre-flight: validate flags against command schema before calling executeKernelCommand.
  // This catches composite-command bugs (e.g. passing --release to release.prepare)
  // with a clear error message, before any pipeline work begins.
  const registry = await getOrBuildWorkspaceRegistry(workspaceRoot);
  const command = registry?.getCommand(commandName);
  if (command) {
    const validFlags = new Set([
      ...Object.keys(KERNEL_UNIVERSAL_FLAGS),
      ...Object.keys(command.flags ?? {}),
    ]);
    for (const entry of argv) {
      if (!entry.startsWith("--")) continue;
      const flagName = entry.slice(2).split("=")[0];
      if (flagName && !validFlags.has(flagName)) {
        const msg = `Unknown flag "--${flagName}" for command "${commandName}" (called from leitstand.hotfix.dev-deploy). Valid flags: ${[...validFlags].sort().join(", ")}`;
        logger.info(`  [hotfix] ${msg}`);
        return { exitCode: 1, summary: msg };
      }
    }
  }

  logger.info(`  [hotfix] ${commandName} ${argv.join(" ")}`);
  const result = (await executeKernelCommand({
    workspaceRoot,
    commandName,
    argv,
    outputFormat: "pretty",
  })) as { exitCode?: number; data?: Record<string, unknown>; summary?: string };
  return {
    exitCode: result.exitCode ?? 0,
    data: result.data,
    summary: result.summary,
  };
}

export async function runLeitstandHotfixDevDeploy(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<HotfixDevDeployResult>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagSite(input);
  if (!systemId) throw new Error("[leitstand.hotfix.dev-deploy] --site is required");
  const missionId = flagString(input, "mission");
  if (!missionId) throw new Error("[leitstand.hotfix.dev-deploy] --mission is required");
  const message = flagString(input, "message");
  const forceBuild = input.flags["force-build"] === true;

  const workpieceDir = path.join(workspaceRoot, "missions", missionId, "workpiece");

  const phases: HotfixDevDeployResult["phases"] = {
    commit: { skipped: false },
    validate: { mode: "postbuild", passed: false },
    reconcile: { ok: false },
    close: { ok: false },
    release: { releaseId: "", prepared: false, ready: false },
    certify: { gate: "dev", decision: "", passed: false },
    deploy: { url: "", deployed: false },
  };

  const failResult = (
    failingPhase: string,
    _summary: string,
  ): KernelCommandResult<HotfixDevDeployResult> => ({
    data: {
      command: "leitstand.hotfix.dev-deploy",
      systemId,
      missionId,
      releaseId: phases.release.releaseId,
      phases,
      deploymentUrl: phases.deploy.url,
      failingPhase,
    },
    summary: `[leitstand.hotfix.dev-deploy] failed at phase: ${failingPhase}`,
    exitCode: 1,
    nextSteps: [
      {
        action: `Fix the failing phase (${failingPhase}), then re-run: pnpm exec werkstatt run leitstand.hotfix.dev-deploy --site ${systemId} --mission ${missionId}`,
        kind: "required",
      },
    ],
  });

  // Phase 1: Commit (skip if workpiece is clean)
  try {
    const gitStatus = execSync("git status --porcelain", {
      cwd: workpieceDir,
      encoding: "utf-8",
    }).trim();
    if (gitStatus === "") {
      phases.commit.skipped = true;
      logger.info("  [hotfix] Phase 1 (commit): workpiece clean, skipping");
    } else {
      const commitArgv = [`--mission=${missionId}`];
      if (message) commitArgv.push(`--message=${message}`);
      const commitResult = await runPhase(workspaceRoot, "mission.git.commit", commitArgv, logger);
      if (commitResult.exitCode !== 0) {
        return failResult("commit", commitResult.summary ?? "mission.git.commit failed");
      }
      const commitSha = execSync("git rev-parse HEAD", {
        cwd: workpieceDir,
        encoding: "utf-8",
      }).trim();
      phases.commit.commitSha = commitSha;
      logger.info(`  [hotfix] Phase 1 (commit): committed as ${commitSha}`);
    }
  } catch (err) {
    return failResult("commit", err instanceof Error ? err.message : String(err));
  }

  // Phase 2: Validate (postbuild first, fallback to full mission.validate)
  const postbuildArgv = [`--mission=${missionId}`];
  if (forceBuild) postbuildArgv.push("--force-build");
  const postbuildResult = await runPhase(
    workspaceRoot,
    "validate.postbuild",
    postbuildArgv,
    logger,
  );
  if (postbuildResult.exitCode === 0) {
    phases.validate.mode = "postbuild";
    phases.validate.passed = true;
    logger.info("  [hotfix] Phase 2 (validate): postbuild passed");
  } else {
    logger.info(
      "  [hotfix] Phase 2 (validate): postbuild failed, falling back to full mission.validate",
    );
    const fullValidateArgv = [`--mission=${missionId}`];
    if (forceBuild) fullValidateArgv.push("--force-build");
    const fullResult = await runPhase(workspaceRoot, "mission.validate", fullValidateArgv, logger);
    if (fullResult.exitCode !== 0) {
      phases.validate.mode = "full";
      phases.validate.passed = false;
      return failResult("validate", fullResult.summary ?? "mission.validate failed");
    }
    phases.validate.mode = "full";
    phases.validate.passed = true;
    logger.info("  [hotfix] Phase 2 (validate): full mission.validate passed");
  }

  // Phase 3: Reconcile
  const reconcileResult = await runPhase(
    workspaceRoot,
    "mission.reconcile",
    [`--mission=${missionId}`],
    logger,
  );
  if (reconcileResult.exitCode !== 0) {
    return failResult("reconcile", reconcileResult.summary ?? "mission.reconcile failed");
  }
  phases.reconcile.ok = true;
  logger.info("  [hotfix] Phase 3 (reconcile): ok");

  // Phase 4: Close
  const closeResult = await runPhase(
    workspaceRoot,
    "mission.close",
    [`--mission=${missionId}`],
    logger,
  );
  if (closeResult.exitCode !== 0) {
    return failResult("close", closeResult.summary ?? "mission.close failed");
  }
  phases.close.ok = true;
  logger.info("  [hotfix] Phase 4 (close): ok");

  // Phase 5: Release (prepare + ready)
  // release.prepare derives the releaseId internally (sequential numbering);
  // we read it from the result data instead of generating it ourselves.
  const prepareArgv = [`--mission=${missionId}`];
  if (forceBuild) prepareArgv.push("--force");
  const prepareResult = await runPhase(workspaceRoot, "release.prepare", prepareArgv, logger);
  if (prepareResult.exitCode !== 0) {
    return failResult("release", prepareResult.summary ?? "release.prepare failed");
  }
  const prepareData = prepareResult.data as { releaseId?: string } | undefined;
  const releaseId = prepareData?.releaseId ?? "";
  if (!releaseId) {
    return failResult("release", "release.prepare returned no releaseId");
  }
  phases.release.releaseId = releaseId;
  phases.release.prepared = true;

  const readyResult = await runPhase(
    workspaceRoot,
    "release.ready",
    [`--release=${releaseId}`],
    logger,
  );
  if (readyResult.exitCode !== 0) {
    return failResult("release", readyResult.summary ?? "release.ready failed");
  }
  phases.release.ready = true;
  logger.info(`  [hotfix] Phase 5 (release): ${releaseId} prepared and ready`);

  // Phase 6: Certify (dev gate)
  const certifyArgv = [`--site=${systemId}`, `--gate=dev`, `--release=${releaseId}`];
  const certifyResult = await runPhase(workspaceRoot, "leitstand.certify", certifyArgv, logger);
  if (certifyResult.exitCode !== 0) {
    return failResult("certify", certifyResult.summary ?? "leitstand.certify failed");
  }
  const certifyData = certifyResult.data as { decisionId?: string } | undefined;
  phases.certify.decision = certifyData?.decisionId ?? "";
  phases.certify.passed = true;
  logger.info("  [hotfix] Phase 6 (certify): dev gate passed");

  // Phase 7: Deploy
  const deployArgv = [`--site=${systemId}`, `--release=${releaseId}`];
  const deployResult = await runPhase(workspaceRoot, "leitstand.dev-deploy", deployArgv, logger);
  if (deployResult.exitCode !== 0) {
    return failResult("deploy", deployResult.summary ?? "leitstand.dev-deploy failed");
  }
  const deployData = deployResult.data as { deploymentUrl?: string } | undefined;
  phases.deploy.url = deployData?.deploymentUrl ?? "";
  phases.deploy.deployed = true;
  logger.info(`  [hotfix] Phase 7 (deploy): deployed to ${phases.deploy.url}`);

  return {
    data: {
      command: "leitstand.hotfix.dev-deploy",
      systemId,
      missionId,
      releaseId,
      phases,
      deploymentUrl: phases.deploy.url,
    },
    summary: `[leitstand.hotfix.dev-deploy] deployed to dev: ${phases.deploy.url}`,
    exitCode: 0,
    nextSteps: [
      {
        action: `Propagate to alt: pnpm exec werkstatt run leitstand.propagate --site ${systemId} --release ${releaseId}`,
        kind: "optional",
      },
    ],
  };
}

// §5.5: leitstand.verify (RFC-0930)
export interface LeitstandVerifyChannel {
  channel: Channel;
  url: string;
  /** True when the server responded with an HTTP status (even 4xx). False on network error, timeout, or 5xx. */
  reachable: boolean;
  httpStatus: number | null;
  buildIdentity: {
    distTreeHash: string | null;
    releaseId: string | null;
    missionId: string | null;
    buildTimestamp: string | null;
  } | null;
  /** RFC-0931: signature verification result (null = not checked or no signature). */
  signatureValid: boolean | null;
  /** RFC-0931: public key URL used for verification (null when not checked or no signature). */
  publicKeyUrl: string | null;
  localState: {
    releaseId: string | null;
    workerVersionId: string | null;
    state: string | null;
    at: string | null;
  } | null;
  matchesLocal: boolean | null;
  error: string | null;
}

export interface LeitstandVerifyData {
  command: "leitstand.verify";
  systemId: string;
  channels: LeitstandVerifyChannel[];
  crossChannel: {
    allReachable: boolean;
    allSameHash: boolean;
    commonHash: string | null;
    hashesByChannel: Record<string, string | null>;
  };
  summary: string;
  exitCode: 0 | 1;
}

function flagBooleanDefault(
  input: KernelCommandInput,
  key: string,
  defaultValue: boolean,
): boolean {
  const v = input.flags[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true";
  return defaultValue;
}

function flagNumberDefault(input: KernelCommandInput, key: string, defaultValue: number): number {
  const v = input.flags[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return defaultValue;
}

async function fetchChannelBuildIdentity(
  channel: Channel,
  url: string,
  authHeaders: Record<string, string>,
  timeoutMs: number,
): Promise<{
  reachable: boolean;
  httpStatus: number | null;
  buildIdentity: LeitstandVerifyChannel["buildIdentity"];
  error: string | null;
}> {
  const base = url.replace(/\/$/, "");
  const fetchUrl = `${base}${BUILD_IDENTITY_PATH}`;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(fetchUrl, {
      headers: authHeaders,
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        reachable: response.status < 500,
        httpStatus: response.status,
        buildIdentity: null,
        error:
          response.status === 404 ? "build-identity.json not found" : `HTTP ${response.status}`,
      };
    }
    const body = (await response.json()) as {
      distTreeHash?: string;
      releaseId?: string;
      missionId?: string;
      buildTimestamp?: string;
    };
    return {
      reachable: true,
      httpStatus: response.status,
      buildIdentity: {
        distTreeHash: body.distTreeHash ?? null,
        releaseId: body.releaseId ?? null,
        missionId: body.missionId ?? null,
        buildTimestamp: body.buildTimestamp ?? null,
      },
      error: null,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      reachable: false,
      httpStatus: null,
      buildIdentity: null,
      error: isAbort
        ? `timeout after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function emptyVerifyResult(
  systemId: string,
  summary: string,
  exitCode: 0 | 1,
): KernelCommandResult<LeitstandVerifyData> {
  return {
    data: {
      command: "leitstand.verify",
      systemId,
      channels: [],
      crossChannel: {
        allReachable: true,
        allSameHash: true,
        commonHash: null,
        hashesByChannel: {},
      },
      summary,
      exitCode,
    },
    summary,
    exitCode,
  };
}

export async function runLeitstandVerify(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<LeitstandVerifyData>> {
  const systemId = flagSite(input);
  if (!systemId) throw new Error("[leitstand.verify] --site is required");

  const channelFilter = flagString(input, "channel") as Channel | undefined;
  if (
    channelFilter &&
    channelFilter !== "dev" &&
    channelFilter !== "alt" &&
    channelFilter !== "main"
  ) {
    return emptyVerifyResult(
      systemId,
      `[leitstand.verify] ${systemId}: invalid channel '${channelFilter}'`,
      1,
    );
  }

  const compareLocal = flagBooleanDefault(input, "compare-local", true);
  const timeoutMs = flagNumberDefault(input, "timeout-ms", 10000);
  const verifySignature = input.flags["verify-signature"] === true;

  const systemConfig = await readSystemConfigSmart(context.workspaceRoot, systemId);
  if (!systemConfig.deployment) {
    return emptyVerifyResult(systemId, `[leitstand.verify] ${systemId}: no deployment config`, 0);
  }

  const systemState = await readSystemStateSmart(context.workspaceRoot, systemId);
  const authHeaders = buildAuthHeader(systemState.accessPin);

  const allChannels: Channel[] = ["dev", "alt", "main"];
  const targetChannels = channelFilter
    ? allChannels.filter((ch) => ch === channelFilter)
    : allChannels;

  const channelConfigs: Array<{ channel: Channel; url: string }> = [];
  for (const ch of targetChannels) {
    const cfg =
      ch === "dev"
        ? systemConfig.deployment.channels.dev
        : ch === "alt"
          ? systemConfig.deployment.channels.alt
          : systemConfig.deployment.channels.main;
    if (cfg) {
      channelConfigs.push({ channel: ch, url: cfg.url });
    }
  }

  if (channelFilter && channelConfigs.length === 0) {
    return emptyVerifyResult(
      systemId,
      `[leitstand.verify] ${systemId}: channel '${channelFilter}' not configured`,
      1,
    );
  }

  const fetchResults = await Promise.all(
    channelConfigs.map(async ({ channel, url }) => {
      const result = await fetchChannelBuildIdentity(channel, url, authHeaders, timeoutMs);
      const localEntry = systemState.lastPropagated?.[channel];
      const localState = localEntry
        ? {
            releaseId: localEntry.releaseId ?? null,
            workerVersionId: localEntry.workerVersionId ?? null,
            state: localEntry.state ?? null,
            at: localEntry.at ?? null,
          }
        : null;

      let matchesLocal: boolean | null = null;
      if (compareLocal && localState && result.buildIdentity?.releaseId) {
        matchesLocal = result.buildIdentity.releaseId === localState.releaseId;
      } else if (compareLocal && !localState) {
        matchesLocal = null;
      }

      let signatureValid: boolean | null = null;
      let pubKeyUrl: string | null = null;

      if (verifySignature && result.buildIdentity) {
        try {
          const base = url.replace(/\/$/, "");
          const pubKeyFetchUrl = `${base}/.well-known/release-pubkey.json`;
          const pubKeyResponse = await fetch(pubKeyFetchUrl, {
            headers: authHeaders,
            redirect: "follow",
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (pubKeyResponse.ok) {
            const pubKeyData = (await pubKeyResponse.json()) as { publicKeyHex?: string };
            if (pubKeyData.publicKeyHex) {
              const fullIdentity = await fetch(`${base}${BUILD_IDENTITY_PATH}`, {
                headers: authHeaders,
                redirect: "follow",
                signal: AbortSignal.timeout(timeoutMs),
              });
              if (fullIdentity.ok) {
                const identityJson = (await fullIdentity.json()) as Record<string, unknown>;
                signatureValid = await verifyBuildIdentitySignature({
                  buildIdentity: identityJson,
                  publicKeyHex: pubKeyData.publicKeyHex,
                });
                pubKeyUrl = pubKeyFetchUrl;
              }
            }
          }
        } catch {
          // Non-fatal: signature verification is best-effort
        }
      }

      return {
        channel,
        url,
        reachable: result.reachable,
        httpStatus: result.httpStatus,
        buildIdentity: result.buildIdentity,
        signatureValid,
        publicKeyUrl: pubKeyUrl,
        localState,
        matchesLocal,
        error: result.error,
      } satisfies LeitstandVerifyChannel;
    }),
  );

  const hashesByChannel: Record<string, string | null> = {};
  for (const ch of fetchResults) {
    hashesByChannel[ch.channel] = ch.buildIdentity?.distTreeHash ?? null;
  }

  const reachableChannels = fetchResults.filter((ch) => ch.reachable && ch.buildIdentity);
  const allReachable = fetchResults.length > 0 && fetchResults.every((ch) => ch.reachable);
  const hashSet = new Set(
    reachableChannels
      .map((ch) => ch.buildIdentity!.distTreeHash)
      .filter((h): h is string => h !== null),
  );
  const allSameHash = reachableChannels.length > 0 && hashSet.size === 1;
  const commonHash = allSameHash ? [...hashSet][0] : null;

  const localMismatch = compareLocal && fetchResults.some((ch) => ch.matchesLocal === false);

  const hasIssues = !allReachable || !allSameHash || localMismatch;

  const reachableCount = fetchResults.filter((ch) => ch.reachable).length;
  const total = fetchResults.length;

  let summary: string;
  if (hasIssues) {
    const issues: string[] = [];
    if (!allReachable) issues.push(`${reachableCount}/${total} reachable`);
    if (reachableChannels.length > 0 && !allSameHash) {
      const hashDetails = Object.entries(hashesByChannel)
        .map(([ch, h]) => `${ch}=${h ?? "unreachable"}`)
        .join(", ");
      issues.push(`hash drift (${hashDetails})`);
    }
    if (localMismatch) issues.push("local mismatch");
    summary = `[leitstand.verify] ${systemId}: ${issues.join(", ")}`;
  } else {
    summary = `[leitstand.verify] ${systemId}: ${reachableCount}/${total} reachable, all same hash${compareLocal ? ", all match local" : ""}`;
  }

  return {
    data: {
      command: "leitstand.verify",
      systemId,
      channels: fetchResults,
      crossChannel: { allReachable, allSameHash, commonHash, hashesByChannel },
      summary,
      exitCode: hasIssues ? 1 : 0,
    },
    summary,
    exitCode: hasIssues ? 1 : 0,
  };
}
