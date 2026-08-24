/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/behavior-snapshot/behavior-snapshot-commands.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0357: initial behavior snapshot capture and diff handlers.</item>
  <item>RFC-0379: add per-route contentHash via @warpgogol/fingerprint HTML normalization.</item>
  <item>RFC-0585: return full snapshot wrapper from capture so release.prepare can write it to disk for diff.</item>
  <item>RFC-0588: exclude redirected routes (301, 308) from snapshot via _redirects parsing.</item>
  <item>RFC-0592: fix wildcard matching so /de/* matches /de (directory root without trailing slash).</item>
  <item>RFC-0595: detect redirect pages, set contentHash: null + redirectTarget.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { collectFiles } from "@warpgogol/werkstatt-shared/share/fs";
import {
  parseRedirectRules,
  extractRedirectTarget,
  type RedirectRule,
} from "@warpgogol/werkstatt-shared/share/redirects";
import { isHtmlRedirectPage } from "@warpgogol/werkstatt-shared/share/semantic";
import { hashHtml } from "@warpgogol/werkstatt-engine/fingerprint";
import type { RouteFact } from "@warpgogol/werkstatt-engine/schemas";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

interface BehaviorSnapshot {
  routes: RouteFact[];
  routeCount: number;
  sitemapHash: string;
  llmsHashes: Record<string, string>;
  robotsDirectives: string;
  headersHash: string;
  redirectsHash: string;
}

export interface BehaviorSnapshotWrapper {
  schemaVersion: string;
  systemId: string;
  releaseId: string | null;
  buildKind: string;
  capturedAt: string;
  behaviorSnapshot: BehaviorSnapshot;
  behaviorSnapshotHash: string;
}

async function hashContent(content: string): Promise<string> {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

export function isRouteRedirected(routePath: string, rules: RedirectRule[]): boolean {
  return rules.some((rule) => {
    if (rule.status !== 301 && rule.status !== 308) return false;
    const escaped = rule.from.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const pattern = escaped.replace(/\/\*$/, "(/.*)?$").replace(/\*/g, ".*");
    const regex = new RegExp(`^${pattern}$`);
    return regex.test(routePath);
  });
}

export async function collectRoutes(
  distDir: string,
  redirectRules: RedirectRule[] = [],
): Promise<RouteFact[]> {
  const routes: RouteFact[] = [];
  if (!existsSync(distDir)) return routes;

  for (const fullPath of await collectFiles(distDir, { extensions: [".html"] })) {
    if (path.basename(fullPath) !== "index.html") continue;
    const relPath = path.relative(distDir, fullPath).replace(/\\/g, "/");
    const routePath = "/" + relPath.replace(/index\.html$/, "").replace(/\/$/, "");
    if (isRouteRedirected(routePath || "/", redirectRules)) continue;
    const html = await fs.readFile(fullPath, "utf8");
    if (isHtmlRedirectPage(html)) {
      const redirectTarget = extractRedirectTarget(html) ?? "unknown";
      routes.push({ path: routePath || "/", contentHash: null, redirectTarget });
    } else {
      const contentHash = hashHtml(html);
      routes.push({ path: routePath || "/", contentHash });
    }
  }

  routes.sort((a, b) => a.path.localeCompare(b.path));
  return routes;
}

async function hashFileIfExists(filePath: string): Promise<string> {
  if (!existsSync(filePath)) return "sha256:absent";
  const content = await fs.readFile(filePath);
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

// §6.5: behavior.snapshot.capture
export interface BehaviorSnapshotCaptureData {
  systemId: string;
  buildKind: "readable" | "production";
  releaseId: string | null;
  behaviorSnapshotHash: string;
  routeCount: number;
  capturedAt: string;
  wrapper: BehaviorSnapshotWrapper;
}

export async function runBehaviorSnapshotCapture(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<BehaviorSnapshotCaptureData>> {
  const { workspaceRoot, logger } = context;
  const distPath = flagString(input, "dist");
  const systemId = flagString(input, "system");
  const buildKind = flagString(input, "build-kind") as "readable" | "production" | undefined;
  const releaseId = flagString(input, "release");

  if (!distPath || !systemId || !buildKind) {
    throw new Error("[behavior.snapshot.capture] --dist, --system, and --build-kind are required");
  }

  if (buildKind !== "readable" && buildKind !== "production") {
    throw new Error(
      `[behavior.snapshot.capture] --build-kind must be 'readable' or 'production', got '${buildKind}'`,
    );
  }

  const distDir = path.resolve(workspaceRoot, distPath);
  if (!existsSync(distDir)) {
    throw new Error(`[behavior.snapshot.capture] dist directory not found: ${distDir}`);
  }

  const redirectsPath = path.join(distDir, "_redirects");
  const redirectsContent = existsSync(redirectsPath)
    ? await fs.readFile(redirectsPath, "utf8")
    : "";
  const redirectRules = redirectsContent ? parseRedirectRules(redirectsContent) : [];

  const routes = await collectRoutes(distDir, redirectRules);
  const sitemapPath = path.join(distDir, "sitemap.xml");
  const sitemapHash = await hashFileIfExists(sitemapPath);
  const robotsPath = path.join(distDir, "robots.txt");
  const robotsContent = existsSync(robotsPath) ? await fs.readFile(robotsPath, "utf8") : "";
  const headersPath = path.join(distDir, "_headers");

  const snapshot: BehaviorSnapshot = {
    routes,
    routeCount: routes.length,
    sitemapHash,
    llmsHashes: {},
    robotsDirectives: robotsContent,
    headersHash: await hashFileIfExists(headersPath),
    redirectsHash: redirectsContent ? await hashContent(redirectsContent) : "sha256:absent",
  };

  const now = new Date().toISOString();
  const wrapper = {
    schemaVersion: "1.0.0",
    systemId,
    releaseId: releaseId ?? null,
    buildKind,
    capturedAt: now,
    behaviorSnapshot: snapshot,
    behaviorSnapshotHash: await hashContent(JSON.stringify(snapshot, null, 2)),
  };

  logger.info(`  Routes: ${snapshot.routeCount}, sitemap: ${snapshot.sitemapHash.slice(0, 16)}...`);

  return {
    data: {
      systemId,
      buildKind,
      releaseId: releaseId ?? null,
      behaviorSnapshotHash: wrapper.behaviorSnapshotHash,
      routeCount: snapshot.routeCount,
      capturedAt: now,
      wrapper,
    },
    summary: `[behavior.snapshot.capture] ${systemId} (${buildKind}): ${snapshot.routeCount} routes`,
    nextSteps: [
      {
        action: `Prepare a release: pnpm exec werkstatt run release.prepare --mission <mission-id>`,
        kind: "optional",
      },
    ],
  };
}

// §6.6: behavior.snapshot.diff
export interface BehaviorSnapshotDiffData {
  verdict: "pass" | "fail";
  baselineHash: string;
  candidateHash: string;
  differences: Array<{ field: string; kind: "added" | "removed" | "changed"; detail: string }>;
}

export async function runBehaviorSnapshotDiff(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<BehaviorSnapshotDiffData>> {
  const { workspaceRoot, logger } = context;
  const baselinePath = flagString(input, "baseline");
  const candidatePath = flagString(input, "candidate");

  if (!baselinePath || !candidatePath) {
    throw new Error("[behavior.snapshot.diff] --baseline and --candidate are required");
  }

  const baselineFile = path.resolve(workspaceRoot, baselinePath);
  const candidateFile = path.resolve(workspaceRoot, candidatePath);

  if (!existsSync(baselineFile)) {
    throw new Error(`[behavior.snapshot.diff] baseline not found: ${baselineFile}`);
  }
  if (!existsSync(candidateFile)) {
    throw new Error(`[behavior.snapshot.diff] candidate not found: ${candidateFile}`);
  }

  const baselineRaw = JSON.parse(await fs.readFile(baselineFile, "utf8"));
  const candidateRaw = JSON.parse(await fs.readFile(candidateFile, "utf8"));

  const baseline = baselineRaw.behaviorSnapshot ?? baselineRaw;
  const candidate = candidateRaw.behaviorSnapshot ?? candidateRaw;

  const baselineHash =
    baselineRaw.behaviorSnapshotHash ?? (await hashContent(JSON.stringify(baseline, null, 2)));
  const candidateHash =
    candidateRaw.behaviorSnapshotHash ?? (await hashContent(JSON.stringify(candidate, null, 2)));

  const differences: Array<{
    field: string;
    kind: "added" | "removed" | "changed";
    detail: string;
  }> = [];

  // Compare route count
  if (baseline.routeCount !== candidate.routeCount) {
    differences.push({
      field: "routeCount",
      kind: "changed",
      detail: `baseline: ${baseline.routeCount}, candidate: ${candidate.routeCount}`,
    });
  }

  // Compare route sets
  const baselineRoutes = new Map((baseline.routes ?? []).map((r: RouteFact) => [r.path, r]));
  const candidateRoutes = new Map((candidate.routes ?? []).map((r: RouteFact) => [r.path, r]));

  for (const [routePath] of baselineRoutes) {
    if (!candidateRoutes.has(routePath)) {
      differences.push({
        field: "routes",
        kind: "removed",
        detail: `route '${routePath}' present in baseline but missing in candidate`,
      });
    }
  }
  for (const [routePath] of candidateRoutes) {
    if (!baselineRoutes.has(routePath)) {
      differences.push({
        field: "routes",
        kind: "added",
        detail: `route '${routePath}' present in candidate but missing in baseline`,
      });
    }
  }

  // Compare sitemap hash
  if (baseline.sitemapHash !== candidate.sitemapHash) {
    differences.push({
      field: "sitemapHash",
      kind: "changed",
      detail: `baseline: ${baseline.sitemapHash}, candidate: ${candidate.sitemapHash}`,
    });
  }

  // Compare headers
  if (baseline.headersHash !== candidate.headersHash) {
    differences.push({
      field: "headers",
      kind: "changed",
      detail: `headers differ: ${baseline.headersHash} vs ${candidate.headersHash}`,
    });
  }

  // Compare redirects
  if (baseline.redirectsHash !== candidate.redirectsHash) {
    differences.push({
      field: "redirects",
      kind: "changed",
      detail: `redirects differ: ${baseline.redirectsHash} vs ${candidate.redirectsHash}`,
    });
  }

  const verdict = differences.length === 0 ? "pass" : "fail";

  if (verdict === "pass") {
    logger.success(`[behavior.snapshot.diff] pass — 0 structural differences`);
  } else {
    logger.error(`[behavior.snapshot.diff] FAIL — ${differences.length} structural differences`);
    for (const diff of differences) {
      logger.error(`  ${diff.kind} ${diff.field}: ${diff.detail}`);
    }
  }

  return {
    data: { verdict, baselineHash, candidateHash, differences },
    exitCode: verdict === "pass" ? 0 : 1,
    summary: `[behavior.snapshot.diff] ${verdict} — ${differences.length} structural differences`,
    nextSteps:
      verdict === "fail"
        ? [
            {
              action: `Review the ${differences.length} structural difference(s) above and decide whether to accept or fix them, then re-run: pnpm exec werkstatt run behavior.snapshot.diff`,
              kind: "required",
            },
          ]
        : undefined,
  };
}
