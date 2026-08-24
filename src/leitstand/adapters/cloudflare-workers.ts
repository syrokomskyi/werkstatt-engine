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
</CHANGE_SUMMARY>
*/

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PropagationResult, HealthCheck, RouteFact } from "@warpgogol/werkstatt-engine/schemas";
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

export function filterEnv(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function createDefaultCommandRunner(): CommandRunner {
  return (cmd, args, opts) =>
    new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: opts?.cwd,
        env: { ...process.env, ...opts?.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => {
        stdout += d.toString();
      });
      child.stderr.on("data", (d) => {
        stderr += d.toString();
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
}

export async function sourceDotenv(filePath: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  if (!existsSync(filePath)) return env;
  const content = await fs.readFile(filePath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (value === "") continue;
    env[key] = value;
  }
  return env;
}

function extractDeploymentUrl(stdout: string): string | undefined {
  const match = stdout.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : undefined;
}

interface BehaviorSnapshot {
  routes: RouteFact[];
}

export async function readBehaviorSnapshot(
  workspaceRoot: string,
  releaseId: string,
): Promise<BehaviorSnapshot | null> {
  const snapshotPath = path.join(workspaceRoot, "releases", releaseId, "behavior-snapshot.json");
  if (!existsSync(snapshotPath)) return null;
  const content = await fs.readFile(snapshotPath, "utf8");
  const parsed = JSON.parse(content) as { behaviorSnapshot?: BehaviorSnapshot } & BehaviorSnapshot;
  return parsed.behaviorSnapshot ?? parsed;
}

/**
 * Verify a redirect route response: HTTP status must be 307 or 308,
 * and if redirectTarget is known (not "unknown"), the Location header
 * must match it exactly.
 *
 * Only HTTP-level redirects are supported. Static hosting that serves
 * meta-refresh HTML pages with HTTP 200 will fail this check — the
 * cloudflare-workers adapter always issues HTTP-level redirects.
 */
export function verifyRedirectRoute(
  status: number,
  location: string,
  route: RouteFact,
): { passed: boolean; detail: string } {
  const isRedirectStatus = status === 307 || status === 308;
  const targetKnown = route.redirectTarget && route.redirectTarget !== "unknown";
  const locationMatches = targetKnown ? location === route.redirectTarget : true;
  const passed = isRedirectStatus && locationMatches;

  return {
    passed,
    detail: isRedirectStatus
      ? locationMatches
        ? `Redirect ${status} → ${location}`
        : `Redirect ${status} but Location mismatch: got ${location}, expected ${route.redirectTarget}`
      : `Expected redirect status (307/308), got ${status}`,
  };
}

function selectProbeRoutes(routes: RouteFact[], maxProbes: number): RouteFact[] {
  const homeRoutes = routes.filter((r) => r.path === "/" || /^\/[a-z]{2}\/?$/.test(r.path));
  const legalRoutes = routes.filter((r) =>
    /legal|imprint|privacy|datenschutz|impressum|agb|terms/i.test(r.path),
  );
  const sitemapRoutes = routes.filter((r) => /sitemap|llms|robots/i.test(r.path));
  const remaining = routes.filter(
    (r) => !homeRoutes.includes(r) && !legalRoutes.includes(r) && !sitemapRoutes.includes(r),
  );
  remaining.sort((a, b) => a.path.localeCompare(b.path));

  const prioritized = [...homeRoutes, ...legalRoutes, ...sitemapRoutes, ...remaining];
  return prioritized.slice(0, maxProbes);
}

async function fetchWithRetry(
  url: string,
  maxAttempts: number,
  redirect: "follow" | "manual" = "follow",
  authHeaders: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; body: string; headers: Headers } | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(url, { redirect, headers: authHeaders });
      const body = await response.text();
      return { ok: response.ok, status: response.status, body, headers: response.headers };
    } catch {
      if (attempt < maxAttempts - 1) {
        const delayMs = Math.min(1000 * 2 ** attempt, 30000);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  return null;
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
