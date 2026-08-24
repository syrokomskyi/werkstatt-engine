/*
<MODULE_CONTRACT>
<purpose>fleet.probe.targets.generate — generate the deterministic probe target list from the workspace (RFC-0341).</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0341: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import type {
  CheckResult,
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { buildGeneratedHeader } from "@warpgogol/werkstatt-engine/kernel";
import { diagnosticsResult } from "@warpgogol/werkstatt-shared/checks";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { readAstroSiteUrl } from "@warpgogol/werkstatt-shared/checks/lib/astro-site-url";
import { readDefaultLanguageCode } from "@warpgogol/werkstatt-shared/checks/lib/i18n";
import { loadSystemManifest } from "@warpgogol/werkstatt-shared/content";

interface ProbeTarget {
  siteId: string;
  origin: string;
  routes: string[];
  sentinels: string[];
}

interface TargetsFile {
  schemaVersion: number;
  targets: ProbeTarget[];
}

interface OverrideEntry {
  siteId?: string;
  origin?: string;
  routes?: string[];
  sentinels?: string[];
  exclude?: boolean;
}

const DEFAULT_SENTINELS = ["<title>[^<]+</title>", "</html>"];
const DEFAULT_EXTRA_ROUTES = ["/sitemap.xml", "/robots.txt"];

async function resolveSupportedLangs(appDir: string, defaultLang: string): Promise<string[]> {
  const contentDir = join(appDir, "src", "content");
  const manifest = await loadSystemManifest(contentDir);
  const supported = (manifest.manifest.i18n as { supported?: Record<string, unknown> } | undefined)
    ?.supported;
  if (supported && typeof supported === "object") {
    return Object.keys(supported);
  }
  return [defaultLang];
}

function buildRoutes(
  defaultLang: string,
  supportedLangs: string[],
  overrides?: string[],
): string[] {
  if (overrides && overrides.length > 0) return overrides;
  const routes: string[] = ["/"];
  for (const lang of supportedLangs) {
    if (lang === defaultLang) continue;
    routes.push(`/${lang}/`);
  }
  routes.push(...DEFAULT_EXTRA_ROUTES);
  return routes;
}

export async function runFleetProbeTargetsGenerate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<CheckResult>> {
  const root = context.workspaceRoot;
  const appsDir = join(root, "apps");
  const appDirs = await context.io.glob("*/", { cwd: appsDir });
  const overridesPath = join(root, "services", "fleet-probe-runner", "targets.overrides.yaml");
  const outputPath = join(root, "services", "fleet-probe-runner", "targets.generated.yaml");

  let overrides: OverrideEntry[] = [];
  if (await context.io.exists(overridesPath)) {
    const text = await context.io.readFile(overridesPath);
    try {
      overrides = yamlParse(text) as OverrideEntry[];
    } catch {
      // fall through with empty overrides
    }
  }

  const overrideMap = new Map<string, OverrideEntry>();
  for (const ov of overrides) {
    if (ov.siteId && !ov.exclude) overrideMap.set(ov.siteId, ov);
  }
  const excluded = new Set(overrides.filter((o) => o.exclude && o.siteId).map((o) => o.siteId!));

  const targets: ProbeTarget[] = [];

  for (const appDirName of appDirs) {
    const siteId = appDirName.replace(/\/$/, "");
    if (excluded.has(siteId)) continue;

    const appDir = join(appsDir, siteId);
    const origin = await readAstroSiteUrl(appDir);
    if (!origin) continue;

    let defaultLang = "de";
    try {
      defaultLang = await readDefaultLanguageCode(join(appDir, "src", "content"));
    } catch {
      continue;
    }

    const supportedLangs = await resolveSupportedLangs(appDir, defaultLang);
    const ov = overrideMap.get(siteId);

    const routes = buildRoutes(defaultLang, supportedLangs, ov?.routes);
    const sentinels = ov?.sentinels ?? DEFAULT_SENTINELS;
    const finalOrigin = ov?.origin ?? origin;

    targets.push({ siteId, origin: finalOrigin, routes, sentinels });
  }

  targets.sort((a, b) => a.siteId.localeCompare(b.siteId));

  const output: TargetsFile = {
    schemaVersion: 1,
    targets,
  };

  const header = buildGeneratedHeader({
    ownerCommand: "fleet.probe.targets.generate",
    filePath: "services/fleet-probe-runner/targets.generated.yaml",
  });
  const body = header + yamlStringify(output) + "\n";
  await context.io.writeFile(outputPath, body);

  return diagnosticsResult("fleet.probe.targets.generate", [
    {
      ruleId: "FLEET-PRB-GEN",
      severity: "info",
      file: "services/fleet-probe-runner/targets.generated.yaml",
      message: `Generated ${targets.length} probe target(s): ${targets.map((t) => t.siteId).join(", ")}`,
      fixHint: "",
    },
  ]);
}
