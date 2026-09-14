/*
<MODULE_CONTRACT>
<purpose>RFC-0379: cloudflare-workers adapter — wraps wrangler deploy with injectable CommandRunner, health verification via @warpgogol/fingerprint HTML normalization.</purpose>
<non-goals>
  <item>Do not implement netlify or other adapters — only cloudflare-workers in this wave.</item>
  <item>Do not log, echo, or serialize secret values or resolved secrets-file contents.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0379: initial cloudflare-workers adapter with injectable CommandRunner, secretsFile resolution, deterministic health probes.</item>
  <item>RFC-0587: export filterEnv and sourceDotenv; add getLimits() for adapter-declared size limits.</item>
  <item>RFC-0595: verify redirect routes by HTTP status + Location header.</item>
  <item>RFC-0623: add runWranglerDeployWithRetry helper with transient error detection for wrangler deploy.</item>
  <item>ADR-0027: sourceDotenv skips empty values to allow process.env fallback for placeholder entries.</item>
  <item>RFC-1091: extract shared health-check helpers to health-helpers.ts, import and re-export for backward compatibility.</item>
</CHANGE_SUMMARY>
*/

import { existsSync } from "node:fs";
import path from "node:path";
import type { PropagationResult, HealthCheck } from "@warpgogol/werkstatt-engine/schemas";
import { hashHtml } from "@warpgogol/werkstatt-engine/fingerprint";
import type {
  CommandRunner,
  DeploymentAdapter,
  PropagateInput,
  RollbackInput,
  RollbackResult,
  HealthInput,
} from "../adapter.ts";
import { runWranglerRollback, extractWorkerVersionId } from "../service-deploy-helpers.ts";
import {
  filterEnv,
  sourceDotenv,
  readBehaviorSnapshot,
  verifyRedirectRoute,
  selectProbeRoutes,
  fetchWithRetry,
  createDefaultCommandRunner,
} from "./health-helpers.ts";

// RFC-1091: re-export for backward compatibility — consumers that import from
// cloudflare-workers.ts continue to work after extraction to health-helpers.ts.
export {
  filterEnv,
  sourceDotenv,
  readBehaviorSnapshot,
  verifyRedirectRoute,
} from "./health-helpers.ts";

const TRANSIENT_ERROR_PATTERNS: readonly RegExp[] = [
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
  /\b522\b/,
  /Gateway Timeout/i,
  /malformed response/i,
  /Received a malformed response from the API/i,
];

function isTransientError(stderr: string): boolean {
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(stderr));
}

async function runWranglerDeployWithRetry(
  runner: CommandRunner,
  args: string[],
  opts: { cwd: string; env: Record<string, string> },
  maxRetries: number = 2,
  delaysMs: number[] = [30_000, 60_000],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const totalAttempts = maxRetries + 1;
  let result = await runner("npx", args, opts);

  for (let attempt = 1; attempt < totalAttempts; attempt++) {
    if (result.exitCode === 0) return result;
    if (!isTransientError(result.stderr)) {
      console.error(`[cloudflare-workers] wrangler deploy failed (exit ${result.exitCode})`);
      console.error(`[cloudflare-workers] stdout: ${result.stdout.slice(-500)}`);
      console.error(`[cloudflare-workers] stderr: ${result.stderr.slice(-500)}`);
      return result;
    }

    const delayMs = delaysMs[attempt - 1] ?? delaysMs[delaysMs.length - 1];
    console.error(
      `[cloudflare-workers] wrangler deploy failed (attempt ${attempt}/${totalAttempts}): transient Cloudflare API error`,
    );
    console.error(`[cloudflare-workers] Retrying in ${delayMs / 1000}s...`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    result = await runner("npx", args, opts);
  }

  if (result.exitCode !== 0) {
    console.error(`[cloudflare-workers] wrangler deploy failed (exit ${result.exitCode})`);
    console.error(`[cloudflare-workers] stdout: ${result.stdout.slice(-500)}`);
    console.error(`[cloudflare-workers] stderr: ${result.stderr.slice(-500)}`);
  }

  return result;
}

function extractDeploymentUrl(stdout: string): string | undefined {
  const match = stdout.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : undefined;
}

export function createCloudflareWorkersAdapter(exec?: CommandRunner): DeploymentAdapter {
  const runner = exec ?? createDefaultCommandRunner();

  return {
    name: "cloudflare-workers",

    async propagate(input: PropagateInput): Promise<PropagationResult> {
      const now = new Date().toISOString();

      const secretsEnv = input.secretsFilePath ? await sourceDotenv(input.secretsFilePath) : {};

      const env: Record<string, string> = { ...filterEnv(process.env), ...secretsEnv };
      if (input.nodeModulesBinPath) {
        env.PATH = `${input.nodeModulesBinPath}:${process.env.PATH ?? ""}`;
      }

      const serverDir = path.join(input.distPath, "server");
      const wranglerConfigDir = existsSync(path.join(serverDir, "wrangler.json"))
        ? serverDir
        : input.distPath;

      const wranglerArgs = [
        "--yes",
        "wrangler",
        "deploy",
        "--config",
        "wrangler.json",
        "--name",
        input.workerName,
      ];
      if (input.secretsFilePath) {
        wranglerArgs.push("--secrets-file", path.resolve(input.secretsFilePath));
      }

      const result = await runWranglerDeployWithRetry(runner, wranglerArgs, {
        cwd: wranglerConfigDir,
        env,
      });

      if (result.exitCode !== 0) {
        return {
          systemId: input.systemId,
          releaseId: input.releaseId,
          state: "failed",
          deploymentUrl: input.url,
          startedAt: now,
          completedAt: new Date().toISOString(),
          healthChecks: [],
        };
      }

      const deployedUrl = input.url || extractDeploymentUrl(result.stdout) || "";
      const workerVersionId = extractWorkerVersionId(result.stdout);

      return {
        systemId: input.systemId,
        releaseId: input.releaseId,
        state: "succeeded",
        deploymentUrl: deployedUrl,
        workerVersionId,
        startedAt: now,
        completedAt: new Date().toISOString(),
        healthChecks: [],
      };
    },

    async rollback(input: RollbackInput): Promise<RollbackResult> {
      const now = new Date().toISOString();

      const env: Record<string, string> = { ...filterEnv(process.env) };

      const result = await runWranglerRollback(input.wranglerConfigDir, env, input.versionId);

      const state = result.exitCode === 0 ? "succeeded" : "failed";

      return {
        systemId: input.systemId,
        channel: input.channel,
        state,
        workerName: input.workerName,
        rolledBackToVersionId: input.versionId,
        startedAt: now,
        completedAt: new Date().toISOString(),
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },

    getLimits() {
      return { maxTotalSize: 20 * 1024 * 1024 * 1024, maxFileSize: 25 * 1024 * 1024 };
    },

    async health(
      input: HealthInput,
    ): Promise<{ state: "healthy" | "unhealthy" | "unknown"; checks: HealthCheck[] }> {
      const maxProbes = 10;
      const maxAttempts = 5;

      const snapshot = await readBehaviorSnapshot(input.workspaceRoot, input.releaseId);
      const routes = snapshot?.routes ?? [];
      const probeRoutes = selectProbeRoutes(routes, maxProbes);

      if (probeRoutes.length === 0) {
        return {
          state: "unknown",
          checks: [
            {
              name: "probe-selection",
              url: input.deploymentUrl,
              status: 0,
              passed: false,
              detail: "No routes available in behavior snapshot for probing",
            },
          ],
        };
      }

      const checks: HealthCheck[] = [];
      let allPassed = true;
      let anyNetworkFailure = false;
      let anyContentMismatch = false;

      for (const route of probeRoutes) {
        const url = `${input.deploymentUrl}${route.path === "/" ? "" : route.path}`;

        if (route.contentHash === null) {
          const response = await fetchWithRetry(
            url,
            maxAttempts,
            "manual",
            input.authHeaders ?? {},
          );

          if (response === null) {
            anyNetworkFailure = true;
            allPassed = false;
            checks.push({
              name: `probe:${route.path}`,
              url,
              status: 0,
              passed: false,
              detail: "Network failure after retries",
            });
            continue;
          }

          const location = response.headers.get("location") ?? "";
          const result = verifyRedirectRoute(response.status, location, route);

          if (!result.passed) allPassed = false;
          if (response.status !== 307 && response.status !== 308) anyContentMismatch = true;

          checks.push({
            name: `probe:${route.path}`,
            url,
            status: response.status,
            passed: result.passed,
            detail: result.detail,
          });
          continue;
        }

        const response = await fetchWithRetry(url, maxAttempts, "follow", input.authHeaders ?? {});

        if (response === null) {
          anyNetworkFailure = true;
          allPassed = false;
          checks.push({
            name: `probe:${route.path}`,
            url,
            status: 0,
            passed: false,
            detail: "Network failure after retries",
            expectedHash: route.contentHash,
          });
          continue;
        }

        if (!response.ok) {
          allPassed = false;
          checks.push({
            name: `probe:${route.path}`,
            url,
            status: response.status,
            passed: false,
            detail: `HTTP ${response.status}`,
            expectedHash: route.contentHash,
          });
          continue;
        }

        if (route.contentHash) {
          const actualHash = hashHtml(response.body);
          const hashMatch = actualHash === route.contentHash;
          if (!hashMatch) {
            allPassed = false;
            anyContentMismatch = true;
          }
          checks.push({
            name: `probe:${route.path}`,
            url,
            status: response.status,
            passed: hashMatch,
            detail: hashMatch ? "Content hash matches" : "Content hash mismatch",
            expectedHash: route.contentHash,
            actualHash,
          });
        } else {
          checks.push({
            name: `probe:${route.path}`,
            url,
            status: response.status,
            passed: true,
            detail: "HTTP OK, no content hash in snapshot",
          });
        }
      }

      const state: "healthy" | "unhealthy" | "unknown" = anyContentMismatch
        ? "unhealthy"
        : anyNetworkFailure
          ? "unknown"
          : allPassed
            ? "healthy"
            : "unhealthy";

      return { state, checks };
    },
  };
}
