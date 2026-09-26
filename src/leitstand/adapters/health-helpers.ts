/*
<MODULE_CONTRACT>
<purpose>RFC-1091: shared health-check helpers extracted from cloudflare-workers adapter for reuse across deployment adapters (cloudflare-workers, github-pages). Provides behavior snapshot reading, probe route selection, HTTP fetch with retry, redirect verification, env filtering, and dotenv sourcing.</purpose>
<non-goals>
  <item>Do not implement adapter-specific logic — each adapter lives in its own file.</item>
  <item>Do not log, echo, or serialize secret values or resolved secrets-file contents.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1091: extract readBehaviorSnapshot, verifyRedirectRoute, selectProbeRoutes, fetchWithRetry, filterEnv, sourceDotenv from cloudflare-workers.ts into shared module.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import type { RouteFact } from "@warpgogol/werkstatt-engine/schemas";
import type { CommandRunner } from "../adapter.ts";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

export function filterEnv(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

export function createDefaultCommandRunner(io: WorkspaceIO = createDefaultIO().io): CommandRunner {
  return async (cmd, args, opts) => {
    const result = await io.exec(cmd, args, { cwd: opts?.cwd, env: opts?.env });
    return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
  };
}

export async function sourceDotenv(
  filePath: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  if (!(await io.exists(filePath))) return env;
  const content = await io.readFile(filePath);
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

export interface BehaviorSnapshot {
  routes: RouteFact[];
}

export async function readBehaviorSnapshot(
  workspaceRoot: string,
  releaseId: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<BehaviorSnapshot | null> {
  const snapshotPath = path.join(workspaceRoot, "releases", releaseId, "behavior-snapshot.json");
  if (!(await io.exists(snapshotPath))) return null;
  const content = await io.readFile(snapshotPath);
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

export function selectProbeRoutes(routes: RouteFact[], maxProbes: number): RouteFact[] {
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

export async function fetchWithRetry(
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
