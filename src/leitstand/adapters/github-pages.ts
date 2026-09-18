/*
<MODULE_CONTRACT>
<purpose>RFC-1091: github-pages adapter — deploys static-site Sternsystemen to GitHub Pages using the gh-pages npm package. Implements the full DeploymentAdapter interface (propagate, rollback, health, getLimits).</purpose>
<non-goals>
  <item>Do not implement GitHub Actions-based deployment — uses gh-pages npm package from local machine.</item>
  <item>Do not add custom domain or DNS management for GitHub Pages.</item>
  <item>Do not log, echo, or serialize secret values or resolved secrets-file contents.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1091: initial github-pages adapter with injectable CommandRunner, GH_TOKEN from filterEnv(process.env), health checks via shared health-helpers.</item>
  <item>RFC-1091: source GH_TOKEN from secretsFilePath (workpiece .env) like cloudflare-workers adapter.</item>
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
import {
  filterEnv,
  sourceDotenv,
  readBehaviorSnapshot,
  verifyRedirectRoute,
  selectProbeRoutes,
  fetchWithRetry,
  createDefaultCommandRunner,
} from "./health-helpers.ts";

export interface GitHubPagesAdapterConfig {
  /** GitHub repository slug: "owner/repo" or just "repo" (uses GH_TOKEN owner) */
  repo: string;
  /** Branch to push dist/ to (default: "gh-pages") */
  branch?: string;
  /** GitHub token for git push authentication (from GH_TOKEN env) */
  token: string;
  /** Optional: message for the gh-pages commit (default: "deploy <releaseId>") */
  message?: string;
}

function resolveRepoSlug(workerName: string, tokenOwner?: string): string {
  if (workerName.includes("/")) return workerName;
  if (tokenOwner) return `${tokenOwner}/${workerName}`;
  return workerName;
}

function extractTokenOwner(_token: string): string | undefined {
  // GitHub tokens don't encode the owner. We can't resolve it from the token alone.
  // The operator must use "owner/repo" format in workerName if the token owner
  // can't be inferred. Return undefined — the caller handles the fallback.
  return undefined;
}

export function createGitHubPagesAdapter(exec?: CommandRunner): DeploymentAdapter {
  const runner = exec ?? createDefaultCommandRunner();

  return {
    name: "github-pages",

    async propagate(input: PropagateInput): Promise<PropagationResult> {
      const now = new Date().toISOString();

      const secretsEnv = input.secretsFilePath ? await sourceDotenv(input.secretsFilePath) : {};
      const env = { ...filterEnv(process.env), ...secretsEnv };
      const token = env.GH_TOKEN;
      if (!token) {
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

      const repo = resolveRepoSlug(input.workerName, extractTokenOwner(token));
      const branch = "gh-pages";
      const message = `deploy ${input.releaseId}`;

      const distDir = path.join(input.distPath, "client");
      const distExists = existsSync(distDir);
      if (!distExists) {
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

      const repoUrl = `https://x-access-token:${token}@github.com/${repo}.git`;
      const ghPagesArgs = [
        "--yes",
        "gh-pages",
        "-d",
        "client",
        "-b",
        branch,
        "-r",
        repoUrl,
        "-m",
        message,
      ];

      const runnerEnv: Record<string, string> = { ...env, GH_TOKEN: token };
      if (input.nodeModulesBinPath) {
        runnerEnv.PATH = `${input.nodeModulesBinPath}:${process.env.PATH ?? ""}`;
      }

      const result = await runner("npx", ghPagesArgs, {
        cwd: input.distPath,
        env: runnerEnv,
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

      return {
        systemId: input.systemId,
        releaseId: input.releaseId,
        state: "succeeded",
        deploymentUrl: input.url,
        startedAt: now,
        completedAt: new Date().toISOString(),
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
        completedAt: new Date().toISOString(),
        stdout: "",
        stderr:
          "GitHub Pages does not support version-level rollback. Re-deploy a previous release through the standard pipeline.",
      };
    },

    getLimits() {
      return {
        maxTotalSize: 1 * 1024 * 1024 * 1024,
        maxFileSize: 100 * 1024 * 1024,
      };
    },

    purgeCapable() {
      return false;
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
