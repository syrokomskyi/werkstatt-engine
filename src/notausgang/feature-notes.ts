/*
<MODULE_CONTRACT>
<purpose>RFC-1120: feature disclosure for notausgang.export — builds a dynamic-feature inventory from cache-clone-readable sources (system.md frontmatter, system-config.yaml, content-tree markers, release dist markers, opportunistic entitlements.generated.yaml) and renders feature-notes.md with static-ok / frozen-at-export / needs-backend verdicts.</purpose>
<non-goals>
  <item>Do not read gitignored generated files as authoritative — entitlements.generated.yaml is opportunistic only (absent in cache clones).</item>
  <item>Do not produce a false static-ok — unknown or disagreeing sources default to needs-backend.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1120: initial feature inventory + verdict mapping + feature-notes.md rendering.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { parseMarkdownFrontmatter } from "@warpgogol/werkstatt-shared/content";
import type { NotausgangFeatureNote } from "@warpgogol/werkstatt-engine/schemas";

export type FeatureVerdict = NotausgangFeatureNote["verdict"];

export interface FeatureInventoryInput {
  /** Directory of the resolved site workspace (cache clone or mission workpiece). */
  siteDir: string;
  /** Release dist directory (releases/<id>/dist) — may not exist. */
  distDir: string;
  /** system-config.yaml parsed content (already loaded by the caller). */
  systemConfig: Record<string, unknown>;
}

interface FeatureSignal {
  feature: string;
  verdict: FeatureVerdict;
  detail: string;
}

/** Known feature-id → verdict mapping. Unknown ids default to needs-backend. */
const FEATURE_VERDICTS: Record<string, { verdict: FeatureVerdict; detail: string }> = {
  "portal-routes": {
    verdict: "needs-backend",
    detail:
      "Portal pages are served by a Cloudflare Worker with bearer-token authorization; they are not part of the static dist output.",
  },
  "worker-serving": {
    verdict: "needs-backend",
    detail:
      "The site is served through a Cloudflare Worker (dist/_worker.js). Static hosting serves the pre-built pages, but worker-level behavior (routing, headers, negotiation) is not reproduced.",
  },
  "markdown-negotiation": {
    verdict: "needs-backend",
    detail:
      "Content negotiation for markdown/JSON variants runs in the Worker; static hosting serves HTML only.",
  },
  "currency-auto-refresh": {
    verdict: "frozen-at-export",
    detail:
      "Currency conversion rates were refreshed at build time; the exported snapshot freezes the rates as of the release build.",
  },
  "freshness-checks": {
    verdict: "frozen-at-export",
    detail:
      "Programmatic freshness/staleness checks ran at build time; the exported content is frozen as of the release build.",
  },
};

const INTEGRATION_VERDICT = {
  verdict: "needs-backend" as const,
  detail:
    "Declared integration requires a live backend or third-party service; the static export does not include it.",
};

function signalForFeatureId(featureId: string): FeatureSignal {
  const known = FEATURE_VERDICTS[featureId];
  if (known) return { feature: featureId, ...known };
  if (featureId.startsWith("integrations.") || featureId.startsWith("integration-")) {
    return { feature: featureId, ...INTEGRATION_VERDICT };
  }
  return {
    feature: featureId,
    verdict: "needs-backend",
    detail:
      "Entitlement or feature not in the known-mapping list; conservatively marked as requiring a backend (fail-honest).",
  };
}

async function readSystemMdFrontmatter(siteDir: string): Promise<Record<string, unknown>> {
  const systemMd = path.join(siteDir, "src", "content", "system.md");
  if (!existsSync(systemMd)) return {};
  const raw = await fs.readFile(systemMd, "utf8");
  return parseMarkdownFrontmatter(raw).data;
}

async function readEntitlements(siteDir: string): Promise<string[]> {
  // Opportunistic only: entitlements.generated.yaml is gitignored in cache clones.
  const p = path.join(siteDir, "src", "entitlements.generated.yaml");
  if (!existsSync(p)) return [];
  try {
    const parsed = parseYaml(await fs.readFile(p, "utf8")) as { features?: unknown };
    return Array.isArray(parsed.features) ? parsed.features.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Build the feature inventory as the union of cache-clone-readable sources.
 * Any disagreement between declared and detected signals resolves to needs-backend.
 */
export async function buildFeatureInventory(
  input: FeatureInventoryInput,
): Promise<NotausgangFeatureNote[]> {
  const detected = new Map<string, FeatureSignal>();

  // Source 1: system.md frontmatter — authored source of truth
  const frontmatter = await readSystemMdFrontmatter(input.siteDir);
  const entitlementsOverride = frontmatter.entitlementsOverride;
  const overrideFeatures = Array.isArray(entitlementsOverride)
    ? entitlementsOverride.map(String)
    : ((entitlementsOverride as { features?: unknown } | undefined)?.features ?? []);
  for (const f of Array.isArray(overrideFeatures) ? overrideFeatures.map(String) : []) {
    detected.set(f, signalForFeatureId(f));
  }
  const integrations = frontmatter.integrations as Record<string, unknown> | undefined;
  for (const key of Object.keys(integrations ?? {})) {
    const id = `integrations.${key}`;
    if (!detected.has(id)) detected.set(id, signalForFeatureId(id));
  }

  // Source 2: system-config.yaml deployment — platform-managed fact
  const deployment = input.systemConfig.deployment as
    | { adapter?: string; channels?: Record<string, unknown> }
    | undefined;
  const workerAdapter =
    typeof deployment?.adapter === "string" && deployment.adapter.includes("worker");

  // Source 3: content-tree markers
  const portalContent = existsSync(
    path.join(input.siteDir, "src", "content", "portal"),
  );

  // Source 4: release dist markers — _worker.js proves worker-level serving
  const distHasWorker = existsSync(path.join(input.distDir, "_worker.js"));

  if (workerAdapter || distHasWorker) {
    if (!detected.has("worker-serving")) {
      detected.set("worker-serving", signalForFeatureId("worker-serving"));
    }
  }
  if (portalContent && !detected.has("portal-routes")) {
    detected.set("portal-routes", signalForFeatureId("portal-routes"));
  }

  // Source 5: opportunistic entitlements.generated.yaml (workpiece only)
  for (const f of await readEntitlements(input.siteDir)) {
    if (!detected.has(f)) detected.set(f, signalForFeatureId(f));
  }

  return [...detected.values()].sort((a, b) => a.feature.localeCompare(b.feature));
}

/** Render feature-notes.md content. Always non-empty, even with zero features. */
export function renderFeatureNotes(params: {
  systemId: string;
  releaseId: string;
  exportedAt: string;
  features: NotausgangFeatureNote[];
}): string {
  const { systemId, releaseId, exportedAt, features } = params;
  const lines: string[] = [
    `# Feature notes — ${systemId}`,
    "",
    `Export of release \`${releaseId}\`, generated ${exportedAt}.`,
    "",
    "This file discloses dynamic features of the site that affect static-hosting viability.",
    "Verdicts: `static-ok` (works as static files), `frozen-at-export` (shipped as a fixed snapshot), `needs-backend` (requires a server or third-party service not included in this package).",
    "",
  ];

  if (features.length === 0) {
    lines.push("No dynamic features detected — the exported site is fully static.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("| Feature | Verdict | Notes |");
  lines.push("| --- | --- | --- |");
  for (const f of features) {
    lines.push(`| \`${f.feature}\` | ${f.verdict} | ${f.detail} |`);
  }
  lines.push("");
  return lines.join("\n");
}
